import {
  Board,
  Move,
  Player,
  RuleSet,
  Square,
  applyMoveToBoard,
  baseKindOf,
  generateLegalMoves,
  generatePieceMoves,
  isInCheck,
  opponentOf,
  royalKindsOf,
} from "@shogi-games/rule-engine";
import { pickOpeningBookMove } from "./openingBook";
import { EvalWeights, getWeights } from "./weights";

type HandMap = Record<string, number>;
type Hands = Record<Player, HandMap>;

const cloneHands = (hands: Hands): Hands => ({
  sente: { ...hands.sente },
  gote: { ...hands.gote },
});

const materialScore = (board: Board, hands: Hands, forPlayer: Player, weights: EvalWeights): number => {
  let score = 0;
  for (const { piece } of board.allPieces()) {
    const value = weights.pieceValues[piece.kind] ?? 0;
    score += piece.owner === forPlayer ? value : -value;
  }
  for (const [kind, count] of Object.entries(hands[forPlayer])) {
    score += (weights.pieceValues[kind] ?? 0) * count;
  }
  for (const [kind, count] of Object.entries(hands[opponentOf(forPlayer)])) {
    score -= (weights.pieceValues[kind] ?? 0) * count;
  }
  return score;
};

const KING_ADJACENT_OFFSETS: { dr: number; dc: number }[] = [
  { dr: -1, dc: -1 },
  { dr: -1, dc: 0 },
  { dr: -1, dc: 1 },
  { dr: 0, dc: -1 },
  { dr: 0, dc: 1 },
  { dr: 1, dc: -1 },
  { dr: 1, dc: 0 },
  { dr: 1, dc: 1 },
];

/** byOwnerが利かせている(移動先にできる)全マスの集合。玉の安全度判定で、
 * 「玉の周囲8マスのうち何マスが相手の利きにさらされているか」を数えるのに使う。
 * isSquareAttackedをマスごとに8回呼ぶより、利き筋を1回だけ全駒ぶん計算する方が速い。 */
const computeAttackMap = (board: Board, byOwner: Player, ruleSet: RuleSet): Set<string> => {
  const attacked = new Set<string>();
  for (const { square, piece } of board.piecesOf(byOwner)) {
    for (const move of generatePieceMoves(board, square, piece, ruleSet)) {
      attacked.add(`${move.to.row},${move.to.col}`);
    }
  }
  return attacked;
};

const countDangerousSquaresAroundKing = (board: Board, kingSq: Square | null, attackMap: Set<string>): number => {
  if (!kingSq) return 0;
  let count = 0;
  for (const { dr, dc } of KING_ADJACENT_OFFSETS) {
    const sq = { row: kingSq.row + dr, col: kingSq.col + dc };
    if (!board.inBounds(sq)) continue;
    if (attackMap.has(`${sq.row},${sq.col}`)) count++;
  }
  return count;
};

/** forPlayerから見た玉の安全度スコア。相手の玉の方が危険にさらされているほどプラス。 */
const kingSafetyScore = (board: Board, ruleSet: RuleSet, forPlayer: Player, weights: EvalWeights): number => {
  const royalKinds = royalKindsOf(ruleSet.pieceSet);
  const opponent = opponentOf(forPlayer);
  const ownKingSq = board.findKing(forPlayer, royalKinds);
  const opponentKingSq = board.findKing(opponent, royalKinds);
  if (!ownKingSq && !opponentKingSq) return 0;

  const attackedByOpponent = computeAttackMap(board, opponent, ruleSet);
  const attackedBySelf = computeAttackMap(board, forPlayer, ruleSet);

  const ownDanger = countDangerousSquaresAroundKing(board, ownKingSq, attackedByOpponent);
  const opponentDanger = countDangerousSquaresAroundKing(board, opponentKingSq, attackedBySelf);

  return weights.kingSafetyWeight * (opponentDanger - ownDanger);
};

const MATE_SCORE = 100000;

export interface SearchNode {
  board: Board;
  hands: Hands;
  turn: Player;
}

export const applyMovePure = (node: SearchNode, move: Move, ruleSet: RuleSet): SearchNode => {
  const { board: nextBoard, captured } = applyMoveToBoard(node.board, node.turn, move, ruleSet);
  const nextHands = cloneHands(node.hands);
  if (captured) {
    const baseKind = baseKindOf(ruleSet.pieceSet, captured.kind);
    nextHands[node.turn][baseKind] = (nextHands[node.turn][baseKind] ?? 0) + 1;
  }
  return { board: nextBoard, hands: nextHands, turn: opponentOf(node.turn) };
};

/** 局面(盤面+持ち駒+手番)を表すキー。置換表(TT)のキーに使う。
 * rule-engine内部のpositionKeyと同じ考え方だが、パッケージをまたいで共有するほどではないのでこちらに複製している。 */
const hashPosition = (board: Board, hands: Hands, turn: Player): string => {
  let key = turn;
  for (let row = 0; row < board.height; row++) {
    for (let col = 0; col < board.width; col++) {
      const piece = board.get({ row, col });
      key += piece ? `${piece.owner[0]}${piece.kind}${piece.promoted ? "+" : ""}|` : ".";
    }
  }
  for (const player of ["sente", "gote"] as Player[]) {
    const entries = Object.entries(hands[player])
      .filter(([, count]) => count > 0)
      .sort(([a], [b]) => a.localeCompare(b));
    for (const [kind, count] of entries) key += `#${player[0]}${kind}${count}`;
  }
  return key;
};

/** 手の並び替えの優先度スコア。αβ枝刈りは良い手ほど先に調べるほど効くので、
 * MVV-LVA(価値の高い駒を、価値の低い駒で取る手を優先)ライクな評価 + 成りの優先度を加える。
 * ttMoveが指定されていれば(前回の探索やより浅い反復深化で見つかった最善手)最優先にする。 */
const moveOrderScore = (board: Board, move: Move, ttMove?: Move): number => {
  if (ttMove && movesEqual(move, ttMove)) return 10000;
  let score = 0;
  const captured = board.get(move.to);
  if (captured) {
    const pieceValues = getWeights().pieceValues;
    const capturedValue = pieceValues[captured.kind] ?? 0;
    const attackerValue = move.type === "move" ? (pieceValues[move.piece] ?? 0) : 0;
    score += 100 + capturedValue * 10 - attackerValue;
  }
  if (move.promote) score += 5;
  return score;
};

const movesEqual = (a: Move, b: Move): boolean =>
  a.type === b.type &&
  a.to.row === b.to.row &&
  a.to.col === b.to.col &&
  a.piece === b.piece &&
  !!a.promote === !!b.promote &&
  (a.type === "drop" || (a.from?.row === b.from?.row && a.from?.col === b.from?.col));

const orderMoves = (board: Board, moves: Move[], ttMove?: Move): Move[] =>
  [...moves].sort((a, b) => moveOrderScore(board, b, ttMove) - moveOrderScore(board, a, ttMove));

const isCaptureMove = (board: Board, move: Move): boolean => !!board.get(move.to);

const MAX_QUIESCENCE_PLY = 6;

/** 静止探索: 葉ノードでいきなり評価値を確定させると「次の手で駒が取られる」ような不安定な局面を
 * 誤評価してしまう(地平線効果)ため、取り合いが続く限り読みを延長してから評価する。 */
const quiescence = (
  node: SearchNode,
  alpha: number,
  beta: number,
  ruleSet: RuleSet,
  deadline: number,
  qPly: number
): number => {
  const opponent = opponentOf(node.turn);
  const legalMoves = generateLegalMoves(node.board, node.turn, node.hands[node.turn], ruleSet, node.hands[opponent]);

  if (legalMoves.length === 0) {
    return -(MATE_SCORE - qPly);
  }

  const opponentMobility = generateLegalMoves(
    node.board,
    opponent,
    node.hands[opponent],
    ruleSet,
    node.hands[node.turn]
  ).length;
  const weights = getWeights();
  // 玉の安全度は取り合いの1手ごとに再計算するほどではないので、静止探索の入り口(qPly=0)でのみ加味する。
  const kingSafety = qPly === 0 ? kingSafetyScore(node.board, ruleSet, node.turn, weights) : 0;
  const standPat =
    materialScore(node.board, node.hands, node.turn, weights) +
    weights.mobilityWeight * (legalMoves.length - opponentMobility) +
    kingSafety;

  if (qPly >= MAX_QUIESCENCE_PLY || Date.now() > deadline) return standPat;
  if (standPat >= beta) return beta;
  if (standPat > alpha) alpha = standPat;

  const captureMoves = legalMoves.filter((m) => isCaptureMove(node.board, m));
  for (const move of orderMoves(node.board, captureMoves)) {
    const child = applyMovePure(node, move, ruleSet);
    const score = -quiescence(child, -beta, -alpha, ruleSet, deadline, qPly + 1);
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
};

type TTFlag = "exact" | "lower" | "upper";
interface TTEntry {
  depth: number;
  score: number;
  flag: TTFlag;
  bestMove?: Move;
}
type TranspositionTable = Map<string, TTEntry>;

const negamax = (
  node: SearchNode,
  depth: number,
  alpha: number,
  beta: number,
  ruleSet: RuleSet,
  deadline: number,
  tt: TranspositionTable
): number => {
  const originalAlpha = alpha;
  const key = hashPosition(node.board, node.hands, node.turn);
  const cached = tt.get(key);
  if (cached && cached.depth >= depth) {
    if (cached.flag === "exact") return cached.score;
    if (cached.flag === "lower") alpha = Math.max(alpha, cached.score);
    else if (cached.flag === "upper") beta = Math.min(beta, cached.score);
    if (alpha >= beta) return cached.score;
  }

  const opponent = opponentOf(node.turn);
  const legalMoves = generateLegalMoves(node.board, node.turn, node.hands[node.turn], ruleSet, node.hands[opponent]);

  if (legalMoves.length === 0) {
    // 手番側に合法手がない = 手番側の負け。探索深さが浅いほど「早い負け」として評価を下げる。
    return -(MATE_SCORE + depth);
  }

  if (depth === 0 || Date.now() > deadline) {
    return quiescence(node, alpha, beta, ruleSet, deadline, 0);
  }

  let best = -Infinity;
  let bestMove: Move | undefined;
  for (const move of orderMoves(node.board, legalMoves, cached?.bestMove)) {
    const child = applyMovePure(node, move, ruleSet);
    const score = -negamax(child, depth - 1, -beta, -alpha, ruleSet, deadline, tt);
    if (score > best) {
      best = score;
      bestMove = move;
    }
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
    if (Date.now() > deadline) break;
  }

  const flag: TTFlag = best <= originalAlpha ? "upper" : best >= beta ? "lower" : "exact";
  tt.set(key, { depth, score: best, flag, bestMove });

  return best;
};

/** 簡易な強制詰み探索。攻め方(isAttackerTurn=true)は王手になる手だけを候補にすることで、
 * 通常の全幅探索よりずっと高速に数手先までの必至/詰みを発見できる。
 * 本格的な詰将棋ソルバー(df-pn等)ではないため、深いor複雑な詰みは見逃すことがある点に注意。 */
/** 詰将棋機能(apps/server/src/puzzles.ts)からも使うため公開している。 */
export const findForcedMate = (
  node: SearchNode,
  ruleSet: RuleSet,
  plyRemaining: number,
  deadline: number,
  isAttackerTurn: boolean
): Move[] | null => {
  if (plyRemaining <= 0 || Date.now() > deadline) return null;

  const opponent = opponentOf(node.turn);
  const legalMoves = generateLegalMoves(node.board, node.turn, node.hands[node.turn], ruleSet, node.hands[opponent]);

  if (!isAttackerTurn) {
    // 受け方の番: 合法手がなければ詰み成立。1つでも逃れる手があればこの筋は不成立。
    if (legalMoves.length === 0) return [];
    let representative: Move[] | null = null;
    for (const move of legalMoves) {
      const child = applyMovePure(node, move, ruleSet);
      const sub = findForcedMate(child, ruleSet, plyRemaining - 1, deadline, true);
      if (sub === null) return null;
      if (!representative) representative = [move, ...sub];
      if (Date.now() > deadline) return null;
    }
    return representative;
  }

  // 攻め方の番: 王手になる手だけを候補にする。
  for (const move of orderMoves(node.board, legalMoves)) {
    const child = applyMovePure(node, move, ruleSet);
    if (!isInCheck(child.board, child.turn, ruleSet)) continue;
    const sub = findForcedMate(child, ruleSet, plyRemaining - 1, deadline, false);
    if (sub !== null) return [move, ...sub];
    if (Date.now() > deadline) return null;
  }
  return null;
};

const MATE_SEARCH_MAX_PLY = 6; // 攻め方3手・受け方3手程度まで(=詰みまで最大3手)を高速にチェックする

export interface ChooseMoveOptions {
  timeBudgetMs?: number;
  maxDepth?: number;
  /** 対局全体でここまでに指された手数。定跡(初手のみ)を使うかどうかの判定に使う。省略時は定跡を使わない。 */
  moveCountSoFar?: number;
}

export interface MoveAnalysis {
  move: Move;
  /** turn側から見た評価値。プラスが大きいほどturn側が有利。 */
  score: number;
}

/** 指し手選択の本体。まず強制詰みが無いか軽く確認し(見つかればそれを優先)、
 * 無ければ反復深化 + αβ枝刈り(置換表・静止探索つき)のnegamaxで最善手を探す。
 * chooseMove()と棋譜振り返り用のanalyzePosition()の両方から使う共通実装。 */
const search = (
  board: Board,
  hands: Hands,
  turn: Player,
  ruleSet: RuleSet,
  options: ChooseMoveOptions
): MoveAnalysis | null => {
  const timeBudgetMs = options.timeBudgetMs ?? 1200;
  const maxDepth = options.maxDepth ?? 4;
  let deadline = Date.now() + timeBudgetMs;

  const rootLegalMoves = generateLegalMoves(board, turn, hands[turn], ruleSet, hands[opponentOf(turn)]);
  if (rootLegalMoves.length === 0) return null;

  const mateBudget = Math.min(300, Math.floor(timeBudgetMs * 0.3));
  if (mateBudget > 20) {
    const mateDeadline = Date.now() + mateBudget;
    const mateLine = findForcedMate({ board, hands, turn }, ruleSet, MATE_SEARCH_MAX_PLY, mateDeadline, true);
    if (mateLine && mateLine.length > 0) {
      return { move: mateLine[0], score: MATE_SCORE };
    }
  }

  const tt: TranspositionTable = new Map();
  let best: MoveAnalysis = { move: rootLegalMoves[0], score: -Infinity };
  let previousBestMove: Move | null = null;
  let timeExtended = false;

  for (let depth = 1; depth <= maxDepth; depth++) {
    if (Date.now() > deadline) break;
    let bestScoreAtDepth = -Infinity;
    let bestMoveAtDepth: Move | null = null;

    for (const move of orderMoves(board, rootLegalMoves, best.move)) {
      const child = applyMovePure({ board, hands, turn }, move, ruleSet);
      const score = -negamax(child, depth - 1, -Infinity, Infinity, ruleSet, deadline, tt);
      if (score > bestScoreAtDepth) {
        bestScoreAtDepth = score;
        bestMoveAtDepth = move;
      }
      if (Date.now() > deadline) break;
    }

    if (bestMoveAtDepth) {
      // 時間配分: 最善手が1つ前の反復深化から変わった(=局面の評価がまだ安定していない、難しい局面の可能性)場合、
      // 一度だけ思考時間を延長して、もう少し深く読んでから確定させる。
      if (!timeExtended && previousBestMove && !movesEqual(previousBestMove, bestMoveAtDepth) && depth >= 2) {
        deadline += Math.floor(timeBudgetMs * 0.3);
        timeExtended = true;
      }
      previousBestMove = bestMoveAtDepth;
      best = { move: bestMoveAtDepth, score: bestScoreAtDepth };
    }
    if (Date.now() > deadline) break;
  }

  return best;
};

/** CPU用の指し手選択。定跡(初手のみ)が使える局面ではそれを優先し、なければ探索する。 */
export const chooseMove = (
  board: Board,
  hands: Hands,
  turn: Player,
  ruleSet: RuleSet,
  options: ChooseMoveOptions = {}
): Move | null => {
  if (options.moveCountSoFar !== undefined) {
    const bookMove = pickOpeningBookMove(ruleSet, options.moveCountSoFar);
    if (bookMove) return bookMove;
  }
  return search(board, hands, turn, ruleSet, options)?.move ?? null;
};

/** 棋譜振り返り用: ある局面での評価値と推奨手を返す。chooseMoveと違い、呼び出し側は評価値も欲しいのでこちらを使う。 */
export const analyzePosition = (
  board: Board,
  hands: Hands,
  turn: Player,
  ruleSet: RuleSet,
  options: ChooseMoveOptions = {}
): MoveAnalysis | null => search(board, hands, turn, ruleSet, options);

/** 探索を一切行わない静的な局面評価(駒得+機動力+玉の安全度)。任意のweightsを渡せるようにしてあるので、
 * AI Stage4の自動チューニング(apps/server/src/ai/tuning.ts)で候補の重みを試すのに使う。
 * 通常の対局中の思考(chooseMove)はnegamax探索の中で同じロジックを使うが、そちらは常に現在有効な
 * getWeights()の値を使う(このevaluateStaticとは別経路)。 */
export const evaluateStatic = (
  board: Board,
  hands: Hands,
  turn: Player,
  ruleSet: RuleSet,
  weights: EvalWeights
): number => {
  const opponent = opponentOf(turn);
  const ownMobility = generateLegalMoves(board, turn, hands[turn], ruleSet, hands[opponent]).length;
  const opponentMobility = generateLegalMoves(board, opponent, hands[opponent], ruleSet, hands[turn]).length;
  const kingSafety = kingSafetyScore(board, ruleSet, turn, weights);
  return materialScore(board, hands, turn, weights) + weights.mobilityWeight * (ownMobility - opponentMobility) + kingSafety;
};

export type { EvalWeights } from "./weights";
