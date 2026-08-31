import {
  Board,
  Move,
  Player,
  RuleSet,
  applyMoveToBoard,
  generateLegalMoves,
  opponentOf,
} from "@shogi-games/rule-engine";

/** 駒の価値(駒得評価用)。厳密な将棋の相場ではなく、MVP用の簡易値。
 * lion(獅子)は王と同格の役駒だが、通常のプレイでは合法手フィルタにより実際に取られることはないため
 * 王と同じく0にしている(取られたら負け、という詰み判定側で守られている)。
 * stone(石)は将棋vs囲碁バリアント用で、それ自体に攻撃力はないが「ただで渡さない」意識づけのため少しだけ価値を持たせる。 */
const PIECE_VALUES: Record<string, number> = {
  pawn: 1,
  tokin: 2,
  lance: 3,
  promoted_lance: 5,
  knight: 4,
  promoted_knight: 5,
  silver: 5,
  promoted_silver: 6,
  gold: 6,
  bishop: 8,
  horse: 10,
  rook: 10,
  dragon: 12,
  king: 0,
  lion: 0,
  stone: 1,
};

/** 機動力(合法手の数)の差に掛ける重み。駒得ほど重要ではないので小さめに。
 * 将棋vs囲碁バリアントのように「打つこと自体に価値がある(盤上を制圧する)」駒がある変則ルールでは、
 * 駒得だけでは差が出ない(打つ前後で持ち駒+盤上駒の合計価値は変わらないため)ので、この機動力項が実質的な判断材料になる。 */
const MOBILITY_WEIGHT = 0.15;

type HandMap = Record<string, number>;
type Hands = Record<Player, HandMap>;

const cloneHands = (hands: Hands): Hands => ({
  sente: { ...hands.sente },
  gote: { ...hands.gote },
});

const materialScore = (board: Board, hands: Hands, forPlayer: Player): number => {
  let score = 0;
  for (const { piece } of board.allPieces()) {
    const value = PIECE_VALUES[piece.kind] ?? 0;
    score += piece.owner === forPlayer ? value : -value;
  }
  for (const [kind, count] of Object.entries(hands[forPlayer])) {
    score += (PIECE_VALUES[kind] ?? 0) * count;
  }
  for (const [kind, count] of Object.entries(hands[opponentOf(forPlayer)])) {
    score -= (PIECE_VALUES[kind] ?? 0) * count;
  }
  return score;
};

const MATE_SCORE = 100000;

interface SearchNode {
  board: Board;
  hands: Hands;
  turn: Player;
}

const applyMovePure = (node: SearchNode, move: Move, ruleSet: RuleSet): SearchNode => {
  const { board: nextBoard, captured } = applyMoveToBoard(node.board, node.turn, move);
  const nextHands = cloneHands(node.hands);
  if (captured) {
    const promotedFrom = ruleSet.pieceSet.find((p) => p.promotesTo === captured.kind);
    const baseKind = promotedFrom ? promotedFrom.kind : captured.kind;
    nextHands[node.turn][baseKind] = (nextHands[node.turn][baseKind] ?? 0) + 1;
  }
  return { board: nextBoard, hands: nextHands, turn: opponentOf(node.turn) };
};

/** 手の並び替えの優先度スコア。αβ枝刈りは良い手ほど先に調べるほど効くので、
 * MVV-LVA(価値の高い駒を、価値の低い駒で取る手を優先)ライクな評価 + 成りの優先度を加える。 */
const moveOrderScore = (board: Board, move: Move): number => {
  let score = 0;
  const captured = board.get(move.to);
  if (captured) {
    const capturedValue = PIECE_VALUES[captured.kind] ?? 0;
    const attackerValue = move.type === "move" ? (PIECE_VALUES[move.piece] ?? 0) : 0;
    score += 100 + capturedValue * 10 - attackerValue;
  }
  if (move.promote) score += 5;
  return score;
};

const orderMoves = (board: Board, moves: Move[]): Move[] =>
  [...moves].sort((a, b) => moveOrderScore(board, b) - moveOrderScore(board, a));

const negamax = (
  node: SearchNode,
  depth: number,
  alpha: number,
  beta: number,
  ruleSet: RuleSet,
  deadline: number
): number => {
  const opponent = opponentOf(node.turn);
  const legalMoves = generateLegalMoves(node.board, node.turn, node.hands[node.turn], ruleSet, node.hands[opponent]);

  if (legalMoves.length === 0) {
    // 手番側に合法手がない = 手番側の負け。探索深さが浅いほど「早い負け」として評価を下げる。
    return -(MATE_SCORE + depth);
  }

  if (depth === 0 || Date.now() > deadline) {
    // 葉ノードでは駒得に加えて機動力(自分と相手の合法手数の差)も評価に加える。
    // node.turn側の合法手数は上ですでに計算済みなので使い回し、相手側だけ追加で計算する。
    const opponentMobility = generateLegalMoves(
      node.board,
      opponent,
      node.hands[opponent],
      ruleSet,
      node.hands[node.turn]
    ).length;
    const mobilityScore = MOBILITY_WEIGHT * (legalMoves.length - opponentMobility);
    return materialScore(node.board, node.hands, node.turn) + mobilityScore;
  }

  let best = -Infinity;
  for (const move of orderMoves(node.board, legalMoves)) {
    const child = applyMovePure(node, move, ruleSet);
    const score = -negamax(child, depth - 1, -beta, -alpha, ruleSet, deadline);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
    if (Date.now() > deadline) break;
  }
  return best;
};

export interface ChooseMoveOptions {
  timeBudgetMs?: number;
  maxDepth?: number;
}

export interface MoveAnalysis {
  move: Move;
  /** turn側から見た評価値。プラスが大きいほどturn側が有利。 */
  score: number;
}

/** 指し手選択の本体。反復深化 + αβ枝刈りのnegamax。時間予算を超えたらその時点の最善手を返す。
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
  const deadline = Date.now() + timeBudgetMs;

  const rootLegalMoves = generateLegalMoves(board, turn, hands[turn], ruleSet, hands[opponentOf(turn)]);
  if (rootLegalMoves.length === 0) return null;

  let best: MoveAnalysis = { move: rootLegalMoves[0], score: -Infinity };

  for (let depth = 1; depth <= maxDepth; depth++) {
    if (Date.now() > deadline) break;
    let bestScoreAtDepth = -Infinity;
    let bestMoveAtDepth: Move | null = null;

    for (const move of orderMoves(board, rootLegalMoves)) {
      const child = applyMovePure({ board, hands, turn }, move, ruleSet);
      const score = -negamax(child, depth - 1, -Infinity, Infinity, ruleSet, deadline);
      if (score > bestScoreAtDepth) {
        bestScoreAtDepth = score;
        bestMoveAtDepth = move;
      }
      if (Date.now() > deadline) break;
    }

    if (bestMoveAtDepth) best = { move: bestMoveAtDepth, score: bestScoreAtDepth };
    if (Date.now() > deadline) break;
  }

  return best;
};

/** CPU用の指し手選択。 */
export const chooseMove = (
  board: Board,
  hands: Hands,
  turn: Player,
  ruleSet: RuleSet,
  options: ChooseMoveOptions = {}
): Move | null => search(board, hands, turn, ruleSet, options)?.move ?? null;

/** 棋譜振り返り用: ある局面での評価値と推奨手を返す。chooseMoveと違い、呼び出し側は評価値も欲しいのでこちらを使う。 */
export const analyzePosition = (
  board: Board,
  hands: Hands,
  turn: Player,
  ruleSet: RuleSet,
  options: ChooseMoveOptions = {}
): MoveAnalysis | null => search(board, hands, turn, ruleSet, options);
