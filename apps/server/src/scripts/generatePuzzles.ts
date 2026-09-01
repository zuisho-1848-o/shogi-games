import "dotenv/config";
import { generatePuzzlesFromSelfPlayGames } from "../puzzles";

/** `npm run puzzles:generate -w apps/server`で実行する。自己対局データから詰将棋を抽出しPuzzleテーブルに保存する。 */
const main = async () => {
  const result = await generatePuzzlesFromSelfPlayGames({ maxGames: 300 });
  console.log(
    `[generatePuzzles] scanned ${result.gamesScanned} games, created ${result.puzzlesCreated} puzzles, ${result.duplicatesSkipped} duplicates skipped`
  );
  process.exit(0);
};

main().catch((e) => {
  console.error("[generatePuzzles] failed:", e);
  process.exit(1);
});
