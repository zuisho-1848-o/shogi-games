import { STANDARD_PIECE_SET } from "../pieceDefinitions";
import { PlacementEntry, RuleSet } from "../types";

const senteBackRow = (row: number): PlacementEntry[] => [
  { kind: "lance", square: { row, col: 0 } },
  { kind: "knight", square: { row, col: 1 } },
  { kind: "silver", square: { row, col: 2 } },
  { kind: "gold", square: { row, col: 3 } },
  { kind: "king", square: { row, col: 4 } },
  { kind: "gold", square: { row, col: 5 } },
  { kind: "silver", square: { row, col: 6 } },
  { kind: "knight", square: { row, col: 7 } },
  { kind: "lance", square: { row, col: 8 } },
];

const pawnRow = (row: number): PlacementEntry[] =>
  Array.from({ length: 9 }, (_, col) => ({ kind: "pawn", square: { row, col } }));

/** 標準9x9将棋の初期配置。row=0が後手側最奥、row=8が先手側最奥。 */
export const STANDARD_RULE_SET: RuleSet = {
  id: "standard",
  name: "標準将棋",
  boardWidth: 9,
  boardHeight: 9,
  pieceSet: STANDARD_PIECE_SET,
  initialSetup: {
    sente: {
      pieces: [
        ...senteBackRow(8),
        { kind: "bishop", square: { row: 7, col: 7 } },
        { kind: "rook", square: { row: 7, col: 1 } },
        ...pawnRow(6),
      ],
    },
    gote: {
      pieces: [
        ...senteBackRow(0),
        { kind: "bishop", square: { row: 1, col: 1 } },
        { kind: "rook", square: { row: 1, col: 7 } },
        ...pawnRow(2),
      ],
    },
  },
  captureRule: {
    mandatoryCapture: false,
    ignoreIfLeavesKingInCheck: true,
  },
  dropRule: "standard",
  drawConditions: {
    sennichite: true,
    jishogi27: false,
  },
};
