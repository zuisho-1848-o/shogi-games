import "dotenv/config"; // apps/server/.env を読み込む(SELF_PLAY_*等)。単独プロセスとしてindex.tsを経由しないため個別に読み込む。
import os from "node:os";
import { getRuleSetById } from "@shogi-games/rule-engine";
import { AI_PROFILES, ensureAiProfileUsers } from "../aiProfiles";
import { playSelfPlayGame } from "../selfPlay";
import { loadTunedWeightsIfPresent } from "../ai/weights";

/**
 * AIエージェント(Claude)を介さずに、バックグラウンドで自己対局を回し続けてデータを蓄積するための
 * 常駐スクリプト。`npm run self-play:daemon -w apps/server`で起動する。
 *
 * 低負荷運用のための工夫:
 *  - 1手ごとに小休止を入れ、CPUを張り付かせない(MOVE_DELAY_MS)。
 *  - 1局ごとにも休止を入れる(GAME_DELAY_MS)。
 *  - システム全体のload averageを見て、混雑していれば自発的に一時停止する(LOAD_PAUSE_THRESHOLD)。
 *  - さらに`nice`を付けて起動することで、OSのスケジューラ上も優先度を下げることを推奨(npmスクリプト側で付与)。
 * これらの値は環境変数で調整できる。
 */

const MOVE_DELAY_MS = Number(process.env.SELF_PLAY_MOVE_DELAY_MS ?? 400);
const GAME_DELAY_MS = Number(process.env.SELF_PLAY_GAME_DELAY_MS ?? 8000);
const LOAD_PAUSE_THRESHOLD = Number(process.env.SELF_PLAY_LOAD_THRESHOLD ?? 0.7);
const LOAD_CHECK_INTERVAL_MS = 15000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 学習用に使う対戦カード(ルール×AI強さの組み合わせ)。標準将棋を中心にしつつ、
 * 盤サイズの違うバリアントも少し混ぜて、幅広い局面を経験させる。 */
const MATCHUPS: { ruleSetId: string; sente: string; gote: string }[] = [
  { ruleSetId: "standard", sente: "ai_easy", gote: "ai_medium" },
  { ruleSetId: "standard", sente: "ai_medium", gote: "ai_easy" },
  { ruleSetId: "standard", sente: "ai_medium", gote: "ai_hard" },
  { ruleSetId: "standard", sente: "ai_hard", gote: "ai_medium" },
  { ruleSetId: "standard", sente: "ai_easy", gote: "ai_easy" },
  { ruleSetId: "standard", sente: "ai_medium", gote: "ai_medium" },
  { ruleSetId: "board_5x5", sente: "ai_medium", gote: "ai_medium" },
  { ruleSetId: "board_7x7", sente: "ai_medium", gote: "ai_hard" },
];

const isSystemBusy = (): boolean => {
  const [load1] = os.loadavg();
  return load1 / os.cpus().length > LOAD_PAUSE_THRESHOLD;
};

const waitForLowLoad = async (): Promise<void> => {
  while (isSystemBusy()) {
    console.log(
      `[selfPlayDaemon] system load is high (loadavg=${os.loadavg()[0].toFixed(2)}, cores=${os.cpus().length}); pausing ${LOAD_CHECK_INTERVAL_MS}ms`
    );
    await sleep(LOAD_CHECK_INTERVAL_MS);
  }
};

let gamesPlayed = 0;
let stopping = false;

const runForever = async (): Promise<void> => {
  loadTunedWeightsIfPresent();
  await ensureAiProfileUsers();
  console.log(
    `[selfPlayDaemon] started. moveDelay=${MOVE_DELAY_MS}ms gameDelay=${GAME_DELAY_MS}ms loadThreshold=${LOAD_PAUSE_THRESHOLD} (Ctrl+Cで停止)`
  );

  let matchupIndex = 0;
  while (!stopping) {
    await waitForLowLoad();
    if (stopping) break;

    const matchup = MATCHUPS[matchupIndex % MATCHUPS.length];
    matchupIndex++;

    const ruleSet = getRuleSetById(matchup.ruleSetId);
    const senteProfile = AI_PROFILES.find((p) => p.slug === matchup.sente);
    const goteProfile = AI_PROFILES.find((p) => p.slug === matchup.gote);
    if (!senteProfile || !goteProfile) continue;

    const start = Date.now();
    try {
      const summary = await playSelfPlayGame({
        ruleSet,
        senteProfile,
        goteProfile,
        moveDelayMs: MOVE_DELAY_MS,
      });
      gamesPlayed++;
      const winner = "winner" in summary.result ? summary.result.winner : "draw";
      console.log(
        `[selfPlayDaemon] game #${gamesPlayed}: ${matchup.ruleSetId} ${matchup.sente}(先)vs${matchup.gote}(後) -> ` +
          `${summary.moveCount}手 ${summary.result.status}(${winner}) ${((Date.now() - start) / 1000).toFixed(1)}s`
      );
    } catch (e) {
      console.error("[selfPlayDaemon] game failed:", e);
    }

    await sleep(GAME_DELAY_MS);
  }

  console.log(`[selfPlayDaemon] stopped. total games played this session: ${gamesPlayed}`);
};

process.on("SIGINT", () => {
  console.log("\n[selfPlayDaemon] shutting down after current game...");
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});

runForever().catch((e) => {
  console.error("[selfPlayDaemon] fatal error:", e);
  process.exit(1);
});
