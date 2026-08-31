import { STANDARD_PIECE_SET } from "../pieceDefinitions";
import { PlacementEntry, RuleSet } from "../types";
import { STANDARD_RULE_SET } from "./standard";

const gotePieces = STANDARD_RULE_SET.initialSetup.gote.pieces;
const sentePieces = STANDARD_RULE_SET.initialSetup.sente.pieces;

/** 指定した駒種のうち、指定列(col)にあるものだけを取り除く。香落ちのように片方だけ落とす場合に使う。 */
const without = (pieces: PlacementEntry[], kind: string, cols: number[]): PlacementEntry[] =>
  pieces.filter((p) => !(p.kind === kind && cols.includes(p.square.col)));

const goteWithout = (removals: [string, number[]][]): PlacementEntry[] =>
  removals.reduce((acc, [kind, cols]) => without(acc, kind, cols), gotePieces);

const senteWithout = (removals: [string, number[]][]): PlacementEntry[] =>
  removals.reduce((acc, [kind, cols]) => without(acc, kind, cols), sentePieces);

/** 駒落ち戦は上手(駒を落とす側)が後手、下手(平手側)が先手というのが伝統的な作法だが、
 * このMVPでは単に「gote側の駒を減らす」プリセットとして実装する。 */
const buildHandicapRuleSet = (params: {
  id: string;
  name: string;
  goteRemovals: [string, number[]][];
  senteRemovals?: [string, number[]][];
}): RuleSet => ({
  ...STANDARD_RULE_SET,
  id: params.id,
  name: params.name,
  pieceSet: STANDARD_PIECE_SET,
  initialSetup: {
    sente: { pieces: params.senteRemovals ? senteWithout(params.senteRemovals) : sentePieces },
    gote: { pieces: goteWithout(params.goteRemovals) },
  },
});

export const HANDICAP_LANCE = buildHandicapRuleSet({
  id: "handicap_lance",
  name: "香落ち",
  goteRemovals: [["lance", [0]]],
});

export const HANDICAP_BISHOP = buildHandicapRuleSet({
  id: "handicap_bishop",
  name: "角落ち",
  goteRemovals: [["bishop", [1]]],
});

export const HANDICAP_ROOK = buildHandicapRuleSet({
  id: "handicap_rook",
  name: "飛車落ち",
  goteRemovals: [["rook", [7]]],
});

export const HANDICAP_ROOK_LANCE = buildHandicapRuleSet({
  id: "handicap_rook_lance",
  name: "飛香落ち",
  goteRemovals: [
    ["rook", [7]],
    ["lance", [0]],
  ],
});

export const HANDICAP_TWO_PIECE = buildHandicapRuleSet({
  id: "handicap_two_piece",
  name: "二枚落ち",
  goteRemovals: [
    ["rook", [7]],
    ["bishop", [1]],
  ],
});

export const HANDICAP_FOUR_PIECE = buildHandicapRuleSet({
  id: "handicap_four_piece",
  name: "四枚落ち",
  goteRemovals: [
    ["rook", [7]],
    ["bishop", [1]],
    ["knight", [1, 7]],
  ],
});

export const HANDICAP_SIX_PIECE = buildHandicapRuleSet({
  id: "handicap_six_piece",
  name: "六枚落ち",
  goteRemovals: [
    ["rook", [7]],
    ["bishop", [1]],
    ["knight", [1, 7]],
    ["lance", [0, 8]],
  ],
});

/** 相互駒落ち: 先手・後手が異なる駒を落とし合うデモプリセット(先手=角落ち, 後手=飛車落ち)。 */
export const HANDICAP_MUTUAL_ROOK_VS_BISHOP = buildHandicapRuleSet({
  id: "handicap_mutual_rook_vs_bishop",
  name: "相互駒落ち(先手:角落ち / 後手:飛車落ち)",
  senteRemovals: [["bishop", [7]]],
  goteRemovals: [["rook", [7]]],
});

export const HANDICAP_RULE_SETS = [
  HANDICAP_LANCE,
  HANDICAP_BISHOP,
  HANDICAP_ROOK,
  HANDICAP_ROOK_LANCE,
  HANDICAP_TWO_PIECE,
  HANDICAP_FOUR_PIECE,
  HANDICAP_SIX_PIECE,
  HANDICAP_MUTUAL_ROOK_VS_BISHOP,
];
