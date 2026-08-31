import { STANDARD_PIECE_SET } from "../pieceDefinitions";
import { PlacementEntry, RuleSet } from "../types";
import { STANDARD_RULE_SET } from "./standard";

/** 成り放題将棋: 成れる場面では必ず成る。駒がどんどん強くなっていく、テンポの速い攻め合い向けルール。 */
export const FORCED_PROMOTION_RULE_SET: RuleSet = {
  ...STANDARD_RULE_SET,
  id: "forced_promotion",
  name: "成り放題将棋",
  promotionRule: "forced",
};

/** 7x7の中型盤面。5x5よりは駒数を増やし、香・桂を含めた構成にしたオリジナル配置。 */
const SEVEN_BY_SEVEN_SENTE: PlacementEntry[] = [
  { kind: "lance", square: { row: 6, col: 0 } },
  { kind: "knight", square: { row: 6, col: 1 } },
  { kind: "silver", square: { row: 6, col: 2 } },
  { kind: "king", square: { row: 6, col: 3 } },
  { kind: "silver", square: { row: 6, col: 4 } },
  { kind: "knight", square: { row: 6, col: 5 } },
  { kind: "lance", square: { row: 6, col: 6 } },
  { kind: "rook", square: { row: 5, col: 1 } },
  { kind: "gold", square: { row: 5, col: 3 } },
  { kind: "bishop", square: { row: 5, col: 5 } },
  ...[0, 1, 2, 3, 4, 5, 6].map((col) => ({ kind: "pawn", square: { row: 4, col } })),
];

const SEVEN_BY_SEVEN_GOTE: PlacementEntry[] = [
  { kind: "lance", square: { row: 0, col: 0 } },
  { kind: "knight", square: { row: 0, col: 1 } },
  { kind: "silver", square: { row: 0, col: 2 } },
  { kind: "king", square: { row: 0, col: 3 } },
  { kind: "silver", square: { row: 0, col: 4 } },
  { kind: "knight", square: { row: 0, col: 5 } },
  { kind: "lance", square: { row: 0, col: 6 } },
  { kind: "bishop", square: { row: 1, col: 1 } },
  { kind: "gold", square: { row: 1, col: 3 } },
  { kind: "rook", square: { row: 1, col: 5 } },
  ...[0, 1, 2, 3, 4, 5, 6].map((col) => ({ kind: "pawn", square: { row: 2, col } })),
];

export const SEVEN_BY_SEVEN_RULE_SET: RuleSet = {
  id: "board_7x7",
  name: "7x7将棋(オリジナル配置)",
  boardWidth: 7,
  boardHeight: 7,
  pieceSet: STANDARD_PIECE_SET,
  initialSetup: {
    sente: { pieces: SEVEN_BY_SEVEN_SENTE },
    gote: { pieces: SEVEN_BY_SEVEN_GOTE },
  },
  captureRule: { mandatoryCapture: false, ignoreIfLeavesKingInCheck: true },
  dropRule: "standard",
  drawConditions: { sennichite: true, jishogi27: false },
};

export const MORE_VARIANT_RULE_SETS = [FORCED_PROMOTION_RULE_SET, SEVEN_BY_SEVEN_RULE_SET];
