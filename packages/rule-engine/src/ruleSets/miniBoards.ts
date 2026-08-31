import { STANDARD_PIECE_SET } from "../pieceDefinitions";
import { PlacementEntry, RuleSet } from "../types";

/**
 * 5x5・3x3の小型盤面ルールセット。
 * 既存の商用/商標登録された特定ゲーム(どうぶつしょうぎ等)の盤面構成・駒デザインを模倣しないよう、
 * 配置は独自に設計したオリジナル構成にしている。
 */

const FIVE_BY_FIVE_SENTE: PlacementEntry[] = [
  { kind: "silver", square: { row: 4, col: 0 } },
  { kind: "bishop", square: { row: 4, col: 1 } },
  { kind: "king", square: { row: 4, col: 2 } },
  { kind: "rook", square: { row: 4, col: 3 } },
  { kind: "silver", square: { row: 4, col: 4 } },
  ...[0, 1, 2, 3, 4].map((col) => ({ kind: "pawn", square: { row: 3, col } })),
];

const FIVE_BY_FIVE_GOTE: PlacementEntry[] = [
  { kind: "silver", square: { row: 0, col: 0 } },
  { kind: "rook", square: { row: 0, col: 1 } },
  { kind: "king", square: { row: 0, col: 2 } },
  { kind: "bishop", square: { row: 0, col: 3 } },
  { kind: "silver", square: { row: 0, col: 4 } },
  ...[0, 1, 2, 3, 4].map((col) => ({ kind: "pawn", square: { row: 1, col } })),
];

export const FIVE_BY_FIVE_RULE_SET: RuleSet = {
  id: "board_5x5",
  name: "5x5将棋(オリジナル配置)",
  boardWidth: 5,
  boardHeight: 5,
  pieceSet: STANDARD_PIECE_SET,
  initialSetup: {
    sente: { pieces: FIVE_BY_FIVE_SENTE },
    gote: { pieces: FIVE_BY_FIVE_GOTE },
  },
  captureRule: { mandatoryCapture: false, ignoreIfLeavesKingInCheck: true },
  dropRule: "standard",
  drawConditions: { sennichite: true, jishogi27: false },
};

const THREE_BY_THREE_SENTE: PlacementEntry[] = [
  { kind: "gold", square: { row: 2, col: 0 } },
  { kind: "king", square: { row: 2, col: 1 } },
  { kind: "gold", square: { row: 2, col: 2 } },
];

const THREE_BY_THREE_GOTE: PlacementEntry[] = [
  { kind: "gold", square: { row: 0, col: 0 } },
  { kind: "king", square: { row: 0, col: 1 } },
  { kind: "gold", square: { row: 0, col: 2 } },
];

/** 王+金2枚のみの詰将棋風超ミニ対局。駒を取ったら即座に持ち駒として打てるので、意外と奥が深い。 */
export const THREE_BY_THREE_RULE_SET: RuleSet = {
  id: "board_3x3",
  name: "3x3将棋(王+金のみ)",
  boardWidth: 3,
  boardHeight: 3,
  pieceSet: STANDARD_PIECE_SET,
  initialSetup: {
    sente: { pieces: THREE_BY_THREE_SENTE },
    gote: { pieces: THREE_BY_THREE_GOTE },
  },
  captureRule: { mandatoryCapture: false, ignoreIfLeavesKingInCheck: true },
  dropRule: "standard",
  drawConditions: { sennichite: true, jishogi27: false },
};

export const MINI_BOARD_RULE_SETS = [FIVE_BY_FIVE_RULE_SET, THREE_BY_THREE_RULE_SET];
