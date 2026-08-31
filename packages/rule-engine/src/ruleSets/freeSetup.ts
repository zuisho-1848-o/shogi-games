import { STANDARD_PIECE_SET } from "../pieceDefinitions";
import { PlacementEntry, RuleSet } from "../types";

/** 標準将棋で各プレイヤーが自由配置に使える駒の上限数(標準の持ち駒プール)。 */
export const STANDARD_PIECE_POOL: Record<string, number> = {
  king: 1,
  rook: 1,
  bishop: 1,
  gold: 2,
  silver: 2,
  knight: 2,
  lance: 2,
  pawn: 9,
};

export interface FreeSetupValidationError {
  reason: string;
}

/** 自由配置の入力が妥当かを検証する。盤外・重複・駒数オーバー・玉0/複数枚を弾く。 */
export const validateFreeSetup = (
  entries: PlacementEntry[],
  boardWidth: number,
  boardHeight: number
): FreeSetupValidationError | null => {
  const counts: Record<string, number> = {};
  const occupied = new Set<string>();

  for (const entry of entries) {
    const { row, col } = entry.square;
    if (row < 0 || row >= boardHeight || col < 0 || col >= boardWidth) {
      return { reason: `square out of bounds: ${row},${col}` };
    }
    const key = `${row},${col}`;
    if (occupied.has(key)) return { reason: `duplicate square: ${key}` };
    occupied.add(key);

    if (!STANDARD_PIECE_SET.some((p) => p.kind === entry.kind)) {
      return { reason: `unknown piece kind: ${entry.kind}` };
    }

    counts[entry.kind] = (counts[entry.kind] ?? 0) + 1;
  }

  if ((counts.king ?? 0) !== 1) return { reason: "king count must be exactly 1" };

  for (const [kind, count] of Object.entries(counts)) {
    const max = STANDARD_PIECE_POOL[kind] ?? 0;
    if (count > max) return { reason: `too many ${kind}: ${count} > ${max}` };
  }

  return null;
};

/** 標準将棋の駒プールを使って、両陣営とも自由に初期配置を決めたルールセットを組み立てる。 */
export const buildFreeSetupRuleSet = (params: {
  id: string;
  senteEntries: PlacementEntry[];
  goteEntries: PlacementEntry[];
  boardWidth?: number;
  boardHeight?: number;
}): RuleSet => {
  const boardWidth = params.boardWidth ?? 9;
  const boardHeight = params.boardHeight ?? 9;

  const senteError = validateFreeSetup(params.senteEntries, boardWidth, boardHeight);
  if (senteError) throw new Error(`invalid sente setup: ${senteError.reason}`);
  const goteError = validateFreeSetup(params.goteEntries, boardWidth, boardHeight);
  if (goteError) throw new Error(`invalid gote setup: ${goteError.reason}`);

  return {
    id: params.id,
    name: "自由配置将棋",
    boardWidth,
    boardHeight,
    pieceSet: STANDARD_PIECE_SET,
    initialSetup: {
      sente: { pieces: params.senteEntries },
      gote: { pieces: params.goteEntries },
    },
    captureRule: { mandatoryCapture: false, ignoreIfLeavesKingInCheck: true },
    dropRule: "standard",
    drawConditions: { sennichite: true, jishogi27: false },
  };
};
