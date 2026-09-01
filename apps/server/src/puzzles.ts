import { Board, GameState, Move, Player, RuleSet, generateLegalMoves, opponentOf } from "@shogi-games/rule-engine";
import { prisma } from "./db";
import { applyMovePure, findForcedMate, SearchNode } from "./ai/simpleAi";

type Hands = Record<Player, Record<string, number>>;

/** 出題局面のシリアライズ形式。RuleSet自体はPuzzle.ruleSetPresetId側で持つので、ここでは
 * 盤面・持ち駒・手番(=攻め方)だけを保存する。 */
export interface PuzzleSnapshot {
  board: { row: number; col: number; kind: string; owner: Player; promoted: boolean }[];
  hands: Hands;
  attacker: Player;
}

const serializeBoard = (board: Board, ruleSet: RuleSet): PuzzleSnapshot["board"] => {
  const cells: PuzzleSnapshot["board"] = [];
  for (let row = 0; row < ruleSet.boardHeight; row++) {
    for (let col = 0; col < ruleSet.boardWidth; col++) {
      const piece = board.get({ row, col });
      if (piece) cells.push({ row, col, ...piece });
    }
  }
  return cells;
};

const deserializeBoard = (cells: PuzzleSnapshot["board"], ruleSet: RuleSet): Board => {
  const board = new Board(ruleSet.boardWidth, ruleSet.boardHeight);
  for (const cell of cells) {
    board.set({ row: cell.row, col: cell.col }, { kind: cell.kind, owner: cell.owner, promoted: cell.promoted });
  }
  return board;
};

/** 王の周囲の駒配置(9マス)を攻め方視点で正規化したシグネチャ。同種の詰み筋の重複検出に使う
 * (完全一致の局面である必要はなく、「玉の囲いの形」が似ていれば同種パターンとみなす)。 */
const mateSignature = (board: Board, hands: Hands, attacker: Player, ruleSet: RuleSet): string => {
  const defender = opponentOf(attacker);
  let kingSquare: { row: number; col: number } | null = null;
  for (let row = 0; row < ruleSet.boardHeight; row++) {
    for (let col = 0; col < ruleSet.boardWidth; col++) {
      const piece = board.get({ row, col });
      if (piece && piece.owner === defender && piece.kind === "king") kingSquare = { row, col };
    }
  }
  if (!kingSquare) return "no-king";

  const parts: string[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const sq = { row: kingSquare.row + dr, col: kingSquare.col + dc };
      // 玉が盤端にいる(詰みの局面では非常によくある)場合、隣接マスが盤外にはみ出すのでboard.inBoundsで弾く。
      if (!board.inBounds(sq)) {
        parts.push("x"); // 盤外
        continue;
      }
      const piece = board.get(sq);
      parts.push(piece ? `${piece.owner[0]}${piece.kind}${piece.promoted ? "+" : ""}` : "-");
    }
  }
  const handPart = Object.entries(hands[attacker])
    .filter(([, n]) => n > 0)
    .map(([kind, n]) => `${kind}${n}`)
    .sort()
    .join(",");
  return `${parts.join("")}|hand:${handPart}`;
};

const MATE_EXTRACTION_MAX_PLY = 7; // 攻め方4手・受け方3手程度まで(この関数の呼び出しコストが高いため探索は短めに)
const MATE_EXTRACTION_DEADLINE_MS = 2000;

/** 1局分の指し手履歴から、「勝った側が強制詰みを持っていた局面」を後ろから探して抽出する。
 * 実際にその対局で指された手そのものではなく、findForcedMateで検証し直した(=完全に正しい)手順を
 * 解答として保存する。これにより、相手の受けが実戦では最善でなかった場合でも解答の正しさは保証される。 */
const extractMatesFromGame = (
  ruleSet: RuleSet,
  moves: Move[],
  winner: Player
): { snapshotNode: SearchNode; solution: Move[] }[] => {
  const state = new GameState(ruleSet);
  const positions: SearchNode[] = [
    { board: state.board, hands: { sente: { ...state.hands.sente }, gote: { ...state.hands.gote } }, turn: state.turn },
  ];
  for (const move of moves) {
    state.applyMove(move);
    positions.push({
      board: state.board,
      hands: { sente: { ...state.hands.sente }, gote: { ...state.hands.gote } },
      turn: state.turn,
    });
  }

  const found: { snapshotNode: SearchNode; solution: Move[] }[] = [];
  // 詰みの直前(攻め方の手番)の局面から、少しずつ遡りながら強制詰みを探す。
  // 同じ対局から複数深さの問題を無闇に量産しないよう、見つかった時点で打ち切る(最も自然な=実戦に近い深さを優先)。
  for (let offset = 1; offset <= MATE_EXTRACTION_MAX_PLY; offset += 2) {
    const idx = positions.length - 1 - offset;
    if (idx < 0) break;
    const node = positions[idx];
    if (node.turn !== winner) continue;
    const deadline = Date.now() + MATE_EXTRACTION_DEADLINE_MS;
    const line = findForcedMate(node, ruleSet, offset, deadline, true);
    if (line && line.length > 0) {
      found.push({ snapshotNode: node, solution: line });
      break;
    }
  }
  return found;
};

export interface GeneratePuzzlesResult {
  gamesScanned: number;
  puzzlesCreated: number;
  duplicatesSkipped: number;
}

/** DBに保存済みの自己対局(AI同士・checkmateで終局)から詰将棋を抽出してPuzzleテーブルへ保存する。
 * docs/AI_ROADMAP.md「関連機能: 詰将棋の自動生成・出題」の実装。 */
export const generatePuzzlesFromSelfPlayGames = async (options: {
  maxGames?: number;
}): Promise<GeneratePuzzlesResult> => {
  const maxGames = options.maxGames ?? 200;

  const dbGames = await prisma.game.findMany({
    where: {
      status: "finished",
      resultStatus: "checkmate",
      isSenteCpu: true,
      isGoteCpu: true,
    },
    include: { ruleSetPreset: true, moves: { orderBy: { moveNumber: "asc" } } },
    take: maxGames,
    orderBy: { createdAt: "desc" },
  });

  let puzzlesCreated = 0;
  let duplicatesSkipped = 0;

  for (const dbGame of dbGames) {
    if (!dbGame.winner || (dbGame.winner !== "sente" && dbGame.winner !== "gote")) continue;
    try {
      const ruleSet = dbGame.ruleSetPreset.config as unknown as RuleSet;
      const moves: Move[] = dbGame.moves.map((m) =>
        m.moveType === "move"
          ? {
              type: "move" as const,
              from: { row: m.fromRow!, col: m.fromCol! },
              to: { row: m.toRow, col: m.toCol },
              piece: m.piece,
              promote: m.promote,
            }
          : { type: "drop" as const, to: { row: m.toRow, col: m.toCol }, piece: m.piece }
      );

      const mates = extractMatesFromGame(ruleSet, moves, dbGame.winner as Player);
      for (const mate of mates) {
        const signature = mateSignature(mate.snapshotNode.board, mate.snapshotNode.hands, dbGame.winner as Player, ruleSet);
        // シグネチャ(玉周りの駒配置)を保存していないので、同ルールセットの既存問題と都度突き合わせる。
        // (件数が少ないうちは全件突き合わせでも問題にならない規模)
        const recentSameRuleSet = await prisma.puzzle.findMany({
          where: { ruleSetPresetId: dbGame.ruleSetPresetId },
          take: 500,
        });
        const dup = recentSameRuleSet.find((p) => {
          const snap = p.snapshot as unknown as PuzzleSnapshot;
          const board = deserializeBoard(snap.board, ruleSet);
          return mateSignature(board, snap.hands, snap.attacker, ruleSet) === signature;
        });

        if (dup) {
          await prisma.puzzle.update({ where: { id: dup.id }, data: { occurrenceCount: { increment: 1 } } });
          duplicatesSkipped++;
          continue;
        }

        const snapshot: PuzzleSnapshot = {
          board: serializeBoard(mate.snapshotNode.board, ruleSet),
          hands: mate.snapshotNode.hands,
          attacker: dbGame.winner as Player,
        };
        await prisma.puzzle.create({
          data: {
            ruleSetPresetId: dbGame.ruleSetPresetId,
            snapshot: snapshot as never,
            solutionMoves: mate.solution as never,
            mateLength: Math.ceil(mate.solution.length / 2),
            sourceGameId: dbGame.id,
          },
        });
        puzzlesCreated++;
      }
    } catch (e) {
      console.error(`[puzzles] failed to extract from game ${dbGame.id}, skipping`, e);
    }
  }

  return { gamesScanned: dbGames.length, puzzlesCreated, duplicatesSkipped };
};

export interface PuzzleAttemptResult {
  solved: boolean;
  correct: boolean;
  message: string;
  /** 正解だった場合、サーバー側が指した受け方の応手(まだ詰んでいなければ)。UIでの継続表示用。 */
  defenderReply?: Move;
  /** 攻め方の手番に戻った時点(または詰み)の局面。 */
  snapshot: PuzzleSnapshot;
}

/** パズルの初期局面から、これまでの(攻め方・受け方交互の)着手列をすべて replay した上で、
 * 攻め方の新しい一手(candidateMove)を検証する。
 * 元の対局の実際の応手ではなく、その都度findForcedMateで再検証するため、想定と異なる正解手順も許容できる。 */
export const attemptPuzzleMove = async (
  puzzleId: string,
  movesSoFar: Move[],
  candidateMove: Move
): Promise<PuzzleAttemptResult> => {
  const puzzle = await prisma.puzzle.findUnique({ where: { id: puzzleId }, include: { ruleSetPreset: true } });
  if (!puzzle) throw new Error("puzzle_not_found");

  const ruleSet = puzzle.ruleSetPreset.config as unknown as RuleSet;
  const snap = puzzle.snapshot as unknown as PuzzleSnapshot;
  let node: SearchNode = {
    board: deserializeBoard(snap.board, ruleSet),
    hands: { sente: { ...snap.hands.sente }, gote: { ...snap.hands.gote } },
    turn: snap.attacker,
  };

  for (const move of movesSoFar) {
    node = applyMovePure(node, move, ruleSet);
  }

  if (node.turn !== snap.attacker) {
    throw new Error("not_attacker_turn"); // movesSoFarの手数が不正(偶数であるべき等)
  }

  const toSnapshot = (n: SearchNode): PuzzleSnapshot => ({
    board: serializeBoard(n.board, ruleSet),
    hands: n.hands,
    attacker: snap.attacker,
  });

  // クライアント側では合法手を絞り込んでいない(盤面クリックをそのまま送ってくる)ため、
  // ここで実際に合法手かどうかをサーバー側で検証してから適用する。
  const legalMoves = generateLegalMoves(node.board, node.turn, node.hands[node.turn], ruleSet, node.hands[opponentOf(node.turn)]);
  const isSameMove = (a: Move, b: Move) =>
    a.type === b.type &&
    a.to.row === b.to.row &&
    a.to.col === b.to.col &&
    a.piece === b.piece &&
    !!a.promote === !!b.promote &&
    (a.type !== "move" || (a.from!.row === b.from!.row && a.from!.col === b.from!.col));
  if (!legalMoves.some((m) => isSameMove(m, candidateMove))) {
    return {
      solved: false,
      correct: false,
      message: "その手は合法手ではありません。",
      snapshot: toSnapshot(node),
    };
  }

  node = applyMovePure(node, candidateMove, ruleSet);

  const opponentHasMoves = (n: SearchNode) =>
    generateLegalMoves(n.board, n.turn, n.hands[n.turn], ruleSet, n.hands[opponentOf(n.turn)]).length > 0;

  if (!opponentHasMoves(node)) {
    return { solved: true, correct: true, message: "詰みです。正解！", snapshot: toSnapshot(node) };
  }

  const remainingBudget = Math.max(1, puzzle.mateLength * 2); // 概算(元の想定手数より短い別解にも余裕を持たせる)
  const deadline = Date.now() + 3000;
  const stillMates = findForcedMate(node, ruleSet, remainingBudget, deadline, false);
  if (stillMates === null) {
    return {
      solved: false,
      correct: false,
      message: "その手では詰みを継続できません。別の手を試してください。",
      snapshot: toSnapshot(node),
    };
  }

  // 受け方の応手を1つ選んでサーバー側が指す(定義上、合法手はすべて詰みに至るのでどれを選んでも正しい)。
  const defenderMove = stillMates[0];
  node = applyMovePure(node, defenderMove, ruleSet);

  return {
    solved: false,
    correct: true,
    message: "正解です。続けて詰ませてください。",
    defenderReply: defenderMove,
    snapshot: toSnapshot(node),
  };
};
