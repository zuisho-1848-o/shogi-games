import { DEFAULT_WEIGHTS, getWeights, loadTunedWeightsIfPresent, saveTunedWeights } from "../ai/weights";
import { collectTrainingPositions, tuneWeights } from "../ai/tuning";

/**
 * AI Stage4: 自己対局(selfPlayDaemon)で蓄積したデータをもとに評価関数の重みを自動チューニングする。
 * `npm run tune:weights -w apps/server`で実行する。既存のtuned-weights.jsonがあればそれを出発点に、
 * 無ければ手作業の初期値(DEFAULT_WEIGHTS)から始める。
 */
(async () => {
  loadTunedWeightsIfPresent();
  const startingWeights = getWeights() ?? DEFAULT_WEIGHTS;

  console.log("[tuneWeights] collecting training positions from finished games...");
  const positions = await collectTrainingPositions({ maxGames: 500, samplesPerGame: 4 });
  console.log(`[tuneWeights] collected ${positions.length} training positions`);

  if (positions.length < 30) {
    console.log(
      "[tuneWeights] not enough data yet (need at least ~30 sampled positions). Let the self-play daemon run longer and try again."
    );
    process.exit(0);
  }

  const result = tuneWeights(positions, startingWeights, { iterations: 8 });

  console.log(`[tuneWeights] MSE before: ${result.errorBefore.toFixed(5)}, after: ${result.errorAfter.toFixed(5)}`);
  console.log("[tuneWeights] tuned weights:", JSON.stringify(result.weights, null, 2));

  if (result.errorAfter < result.errorBefore) {
    saveTunedWeights(result.weights);
    console.log("[tuneWeights] saved improved weights to tuned-weights.json");
  } else {
    console.log("[tuneWeights] no improvement found this run; keeping existing weights");
  }

  process.exit(0);
})().catch((e) => {
  console.error("[tuneWeights] failed:", e);
  process.exit(1);
});
