import { Board, toBoardDirection } from "./board";
import { getPieceDefinition } from "./pieceDefinitions";
import { Move, Piece, PieceDefinition, Player, RuleSet, Square, opponentOf, squareKey } from "./types";

/** 盤の奥行きに応じた成り可能ゾーンの深さ。標準9x9なら3段。 */
export const promotionZoneDepth = (boardHeight: number): number => Math.max(1, Math.floor(boardHeight / 3));

export const isInPromotionZone = (owner: Player, sq: Square, board: Board): boolean => {
  const depth = promotionZoneDepth(board.height);
  return owner === "sente" ? sq.row < depth : sq.row >= board.height - depth;
};

const isLastRowUnmovable = (kind: string, owner: Player, row: number, height: number): boolean => {
  // 歩・香は最終段、桂は最終2段に進めると次に動けなくなるため、その手自体を禁止する(標準ルール)。
  const distFromFar = owner === "sente" ? row : height - 1 - row;
  if (kind === "pawn" || kind === "lance") return distFromFar === 0;
  if (kind === "knight") return distFromFar <= 1;
  return false;
};

/** 王(または獅子王バリアントの獅子など)として扱う駒種の集合。 */
export const royalKindsOf = (pieceSet: PieceDefinition[]): Set<string> => {
  const kinds = new Set(pieceSet.filter((p) => p.isRoyal).map((p) => p.kind));
  kinds.add("king");
  return kinds;
};

/** 獅子の2マス先ジャンプ(縦横斜め8方向)。中間マスの駒は無視して飛び越え、着地マスだけを見る簡易実装。
 * 本来の中将棋の獅子は中間マスの駒も取れる/複数回移動できるが、MVPでは「2マス先まで自由に届く」挙動に簡略化している。 */
const LION_JUMP_OFFSETS: { dr: number; dc: number }[] = [
  { dr: -2, dc: 0 },
  { dr: 2, dc: 0 },
  { dr: 0, dc: -2 },
  { dr: 0, dc: 2 },
  { dr: -2, dc: -2 },
  { dr: -2, dc: 2 },
  { dr: 2, dc: -2 },
  { dr: 2, dc: 2 },
];

/** 盤上の駒の移動先(疑似合法: 王手放置チェックはしない)を列挙する。 */
export const generatePieceMoves = (
  board: Board,
  from: Square,
  piece: Piece,
  ruleSet: RuleSet
): Move[] => {
  const def = getPieceDefinition(ruleSet.pieceSet, piece.kind);
  const moves: Move[] = [];

  for (const vec of def.moves) {
    const dir = toBoardDirection(piece.owner, vec.dr, vec.dc);
    let steps = 1;
    while (steps <= (vec.range === Infinity ? Math.max(board.width, board.height) : vec.range)) {
      const to: Square = { row: from.row + dir.dr * steps, col: from.col + dir.dc * steps };
      if (!board.inBounds(to)) break;
      const occupant = board.get(to);
      if (occupant && occupant.owner === piece.owner) break;

      moves.push(...buildMoveVariants(board, from, to, piece, def, ruleSet));

      if (occupant) break; // 敵駒を取ったらそのマスで利きが止まる
      steps++;
    }
  }

  if (def.specialMove === "lion-double-step") {
    for (const offset of LION_JUMP_OFFSETS) {
      const to: Square = { row: from.row + offset.dr, col: from.col + offset.dc };
      if (!board.inBounds(to)) continue;
      const occupant = board.get(to);
      if (occupant && occupant.owner === piece.owner) continue;
      moves.push(...buildMoveVariants(board, from, to, piece, def, ruleSet));
    }
  }

  return moves;
};

const buildMoveVariants = (
  board: Board,
  from: Square,
  to: Square,
  piece: Piece,
  def: PieceDefinition,
  ruleSet: RuleSet
): Move[] => {
  const variants: Move[] = [];
  const canPromoteHere =
    def.canPromote &&
    !piece.promoted &&
    (isInPromotionZone(piece.owner, from, board) || isInPromotionZone(piece.owner, to, board));

  const mustPromote =
    def.canPromote &&
    (isLastRowUnmovable(def.kind, piece.owner, to.row, board.height) ||
      (ruleSet.promotionRule === "forced" && canPromoteHere));

  if (!mustPromote) {
    variants.push({ type: "move", from, to, piece: piece.kind, promote: false });
  }
  if (canPromoteHere) {
    variants.push({ type: "move", from, to, piece: piece.kind, promote: true });
  }
  return variants;
};

/** 持ち駒からの打ち手を列挙する(標準dropRuleのみ対応。二歩は禁止)。 */
export const generateDropMoves = (
  board: Board,
  owner: Player,
  hand: Record<string, number>,
  ruleSet: RuleSet
): Move[] => {
  if (ruleSet.dropRule === "none") return [];
  const moves: Move[] = [];

  for (const [kind, count] of Object.entries(hand)) {
    if (count <= 0) continue;
    const def = getPieceDefinition(ruleSet.pieceSet, kind);
    if (!def.droppable) continue;

    for (let row = 0; row < board.height; row++) {
      for (let col = 0; col < board.width; col++) {
        const sq = { row, col };
        if (board.get(sq)) continue;
        if (isLastRowUnmovable(kind, owner, row, board.height)) continue;
        if (kind === "pawn" && hasUnpromotedPawnInFile(board, owner, col)) continue; // 二歩禁止
        moves.push({ type: "drop", to: sq, piece: kind });
      }
    }
  }

  return moves;
};

const hasUnpromotedPawnInFile = (board: Board, owner: Player, col: number): boolean => {
  for (let row = 0; row < board.height; row++) {
    const piece = board.get({ row, col });
    if (piece && piece.owner === owner && piece.kind === "pawn" && !piece.promoted) return true;
  }
  return false;
};

const applyMoveToBoard = (board: Board, owner: Player, move: Move): { board: Board; captured: Piece | null } => {
  const next = board.clone();
  let captured: Piece | null = null;

  if (move.type === "move" && move.from) {
    const piece = next.get(move.from);
    if (!piece) throw new Error("no piece at from square");
    captured = next.get(move.to);
    next.set(move.from, null);
    next.set(move.to, { ...piece, promoted: piece.promoted || !!move.promote });
  } else {
    next.set(move.to, { kind: move.piece, owner, promoted: false });
  }

  return { board: next, captured };
};

export const isSquareAttacked = (board: Board, target: Square, byOwner: Player, ruleSet: RuleSet): boolean => {
  for (const { square, piece } of board.piecesOf(byOwner)) {
    const pseudoMoves = generatePieceMoves(board, square, piece, ruleSet);
    if (pseudoMoves.some((m) => m.to.row === target.row && m.to.col === target.col)) return true;
  }
  return false;
};

export const isInCheck = (board: Board, owner: Player, ruleSet: RuleSet): boolean => {
  const kingSq = board.findKing(owner, royalKindsOf(ruleSet.pieceSet));
  if (!kingSq) return false;
  return isSquareAttacked(board, kingSq, opponentOf(owner), ruleSet);
};

/** 打ち歩詰め判定: 歩を打った結果が相手の即詰みになる手かどうか。
 * 相手の応手を数える必要があるため相手の持ち駒(opponentHand)を必要とする。 */
const isUchifuzume = (
  board: Board,
  move: Move,
  dropOwner: Player,
  ruleSet: RuleSet,
  opponentHand: Record<string, number>
): boolean => {
  if (move.type !== "drop" || move.piece !== "pawn") return false;

  const { board: nextBoard } = applyMoveToBoard(board, dropOwner, move);
  const opponent = opponentOf(dropOwner);
  if (!isInCheck(nextBoard, opponent, ruleSet)) return false;

  const opponentResponses = generateLegalMoves(nextBoard, opponent, opponentHand, ruleSet, {});
  return opponentResponses.length === 0;
};

/** 王手放置になる手・打ち歩詰めになる手を除外した、実際に指せる合法手一覧を返す。
 * opponentHandは打ち歩詰め判定(相手に応手があるか)のためだけに使う。省略時はチェックをスキップする。 */
export const generateLegalMoves = (
  board: Board,
  owner: Player,
  hand: Record<string, number>,
  ruleSet: RuleSet,
  opponentHand: Record<string, number> = {}
): Move[] => {
  const pseudo: Move[] = [];
  for (const { square, piece } of board.piecesOf(owner)) {
    pseudo.push(...generatePieceMoves(board, square, piece, ruleSet));
  }
  pseudo.push(...generateDropMoves(board, owner, hand, ruleSet));

  const legal = pseudo
    .filter((move) => {
      const { board: next } = applyMoveToBoard(board, owner, move);
      return !isInCheck(next, owner, ruleSet);
    })
    .filter((move) => !isUchifuzume(board, move, owner, ruleSet, opponentHand));

  if (ruleSet.captureRule.mandatoryCapture) {
    const captures = legal.filter((m) => isCapture(board, m));
    if (captures.length > 0) return captures;
  }

  return legal;
};

export const isCapture = (board: Board, move: Move): boolean => !!board.get(move.to);

export { applyMoveToBoard, squareKey };
