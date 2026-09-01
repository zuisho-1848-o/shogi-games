import fs from "node:fs";
import path from "node:path";

export interface EvalWeights {
  pieceValues: Record<string, number>;
  mobilityWeight: number;
  kingSafetyWeight: number;
}

/** 手作業で決めた初期値。AI Stage4のチューニングはここを出発点にする。 */
export const DEFAULT_WEIGHTS: EvalWeights = {
  pieceValues: {
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
  },
  mobilityWeight: 0.15,
  kingSafetyWeight: 0.3,
};

const TUNED_WEIGHTS_PATH = path.join(__dirname, "tuned-weights.json");

let currentWeights: EvalWeights = DEFAULT_WEIGHTS;

/** サーバー起動時に呼ぶ。チューニング済みの重みファイルがあればそれを使い、無ければ既定値のまま。 */
export const loadTunedWeightsIfPresent = (): void => {
  try {
    if (!fs.existsSync(TUNED_WEIGHTS_PATH)) return;
    const raw = fs.readFileSync(TUNED_WEIGHTS_PATH, "utf-8");
    const parsed = JSON.parse(raw) as EvalWeights;
    if (parsed.pieceValues && typeof parsed.mobilityWeight === "number") {
      currentWeights = parsed;
      console.log(`[ai/weights] loaded tuned weights from ${TUNED_WEIGHTS_PATH}`);
    }
  } catch (e) {
    console.error("[ai/weights] failed to load tuned weights, using defaults", e);
  }
};

export const getWeights = (): EvalWeights => currentWeights;

/** チューニングスクリプトから呼ぶ。ディスクに保存し、次回起動時から使われるようにする。 */
export const saveTunedWeights = (weights: EvalWeights): void => {
  fs.writeFileSync(TUNED_WEIGHTS_PATH, JSON.stringify(weights, null, 2), "utf-8");
  currentWeights = weights;
};
