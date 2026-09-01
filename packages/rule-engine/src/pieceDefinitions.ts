import { PieceDefinition } from "./types";

const gold: MoveVectorList = [
  { dr: -1, dc: -1, range: 1 },
  { dr: -1, dc: 0, range: 1 },
  { dr: -1, dc: 1, range: 1 },
  { dr: 0, dc: -1, range: 1 },
  { dr: 0, dc: 1, range: 1 },
  { dr: 1, dc: 0, range: 1 },
];

type MoveVectorList = { dr: number; dc: number; range: number; jump?: boolean }[];

/** 標準将棋(9x9)の駒定義。dr,dcは先手基準(前進=-row)。 */
export const STANDARD_PIECE_SET: PieceDefinition[] = [
  {
    kind: "pawn",
    displayName: { sente: "歩", gote: "歩" },
    moves: [{ dr: -1, dc: 0, range: 1 }],
    promotesTo: "tokin",
    canPromote: true,
    droppable: true,
  },
  {
    kind: "tokin",
    displayName: { sente: "と", gote: "と" },
    moves: gold,
    canPromote: false,
    droppable: false,
  },
  {
    kind: "lance",
    displayName: { sente: "香", gote: "香" },
    moves: [{ dr: -1, dc: 0, range: Infinity }],
    promotesTo: "promoted_lance",
    canPromote: true,
    droppable: true,
  },
  {
    kind: "promoted_lance",
    displayName: { sente: "成香", gote: "成香" },
    moves: gold,
    canPromote: false,
    droppable: false,
  },
  {
    kind: "knight",
    displayName: { sente: "桂", gote: "桂" },
    moves: [
      { dr: -2, dc: -1, range: 1, jump: true },
      { dr: -2, dc: 1, range: 1, jump: true },
    ],
    promotesTo: "promoted_knight",
    canPromote: true,
    droppable: true,
  },
  {
    kind: "promoted_knight",
    displayName: { sente: "成桂", gote: "成桂" },
    moves: gold,
    canPromote: false,
    droppable: false,
  },
  {
    kind: "silver",
    displayName: { sente: "銀", gote: "銀" },
    moves: [
      { dr: -1, dc: -1, range: 1 },
      { dr: -1, dc: 0, range: 1 },
      { dr: -1, dc: 1, range: 1 },
      { dr: 1, dc: -1, range: 1 },
      { dr: 1, dc: 1, range: 1 },
    ],
    promotesTo: "promoted_silver",
    canPromote: true,
    droppable: true,
  },
  {
    kind: "promoted_silver",
    displayName: { sente: "成銀", gote: "成銀" },
    moves: gold,
    canPromote: false,
    droppable: false,
  },
  {
    kind: "gold",
    displayName: { sente: "金", gote: "金" },
    moves: gold,
    canPromote: false,
    droppable: true,
  },
  {
    kind: "bishop",
    displayName: { sente: "角", gote: "角" },
    moves: [
      { dr: -1, dc: -1, range: Infinity },
      { dr: -1, dc: 1, range: Infinity },
      { dr: 1, dc: -1, range: Infinity },
      { dr: 1, dc: 1, range: Infinity },
    ],
    promotesTo: "horse",
    canPromote: true,
    droppable: true,
  },
  {
    kind: "horse",
    displayName: { sente: "馬", gote: "馬" },
    moves: [
      { dr: -1, dc: -1, range: Infinity },
      { dr: -1, dc: 1, range: Infinity },
      { dr: 1, dc: -1, range: Infinity },
      { dr: 1, dc: 1, range: Infinity },
      { dr: -1, dc: 0, range: 1 },
      { dr: 1, dc: 0, range: 1 },
      { dr: 0, dc: -1, range: 1 },
      { dr: 0, dc: 1, range: 1 },
    ],
    canPromote: false,
    droppable: false,
  },
  {
    kind: "rook",
    displayName: { sente: "飛", gote: "飛" },
    moves: [
      { dr: -1, dc: 0, range: Infinity },
      { dr: 1, dc: 0, range: Infinity },
      { dr: 0, dc: -1, range: Infinity },
      { dr: 0, dc: 1, range: Infinity },
    ],
    promotesTo: "dragon",
    canPromote: true,
    droppable: true,
  },
  {
    kind: "dragon",
    displayName: { sente: "龍", gote: "龍" },
    moves: [
      { dr: -1, dc: 0, range: Infinity },
      { dr: 1, dc: 0, range: Infinity },
      { dr: 0, dc: -1, range: Infinity },
      { dr: 0, dc: 1, range: Infinity },
      { dr: -1, dc: -1, range: 1 },
      { dr: -1, dc: 1, range: 1 },
      { dr: 1, dc: -1, range: 1 },
      { dr: 1, dc: 1, range: 1 },
    ],
    canPromote: false,
    droppable: false,
  },
  {
    kind: "king",
    displayName: { sente: "王", gote: "玉" },
    moves: [
      { dr: -1, dc: -1, range: 1 },
      { dr: -1, dc: 0, range: 1 },
      { dr: -1, dc: 1, range: 1 },
      { dr: 0, dc: -1, range: 1 },
      { dr: 0, dc: 1, range: 1 },
      { dr: 1, dc: -1, range: 1 },
      { dr: 1, dc: 0, range: 1 },
      { dr: 1, dc: 1, range: 1 },
    ],
    canPromote: false,
    droppable: false,
  },
  {
    kind: "lion",
    displayName: { sente: "獅", gote: "獅" },
    // 中将棋の獅子由来。王と同じ8方向1マスの動きに加え、2マス先まで(中間の駒を飛び越えて)動ける。
    moves: [
      { dr: -1, dc: -1, range: 1 },
      { dr: -1, dc: 0, range: 1 },
      { dr: -1, dc: 1, range: 1 },
      { dr: 0, dc: -1, range: 1 },
      { dr: 0, dc: 1, range: 1 },
      { dr: 1, dc: -1, range: 1 },
      { dr: 1, dc: 0, range: 1 },
      { dr: 1, dc: 1, range: 1 },
    ],
    specialMove: "lion-double-step",
    canPromote: false,
    droppable: true,
    isRoyal: true,
  },
  {
    kind: "stone",
    displayName: { sente: "石", gote: "石" },
    // 囲碁の石をイメージした駒。自分では一切移動できず、打つ(盤外から配置する)ことしかできない。
    // 将棋vs囲碁バリアントで、盤上に置いたら動かせない壁として使う。
    moves: [],
    canPromote: false,
    droppable: true,
  },
];

export const getPieceDefinition = (
  pieceSet: PieceDefinition[],
  kind: string
): PieceDefinition => {
  const def = pieceSet.find((p) => p.kind === kind);
  if (!def) throw new Error(`Unknown piece kind: ${kind}`);
  return def;
};

/** 成り駒のkind(例: "tokin")から、成る前のkind(例: "pawn")を逆引きする。
 * 成り駒でなければそのまま返す。手駒に戻す時(持ち駒は常に不成の種類で数える)やUSI/SFEN変換等、
 * 「成っていても元の駒種を知りたい」場面で使う。 */
export const baseKindOf = (pieceSet: PieceDefinition[], kind: string): string => {
  const promotedFrom = pieceSet.find((p) => p.promotesTo === kind);
  return promotedFrom ? promotedFrom.kind : kind;
};
