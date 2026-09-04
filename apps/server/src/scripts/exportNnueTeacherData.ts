import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { GameState, Move, RuleSet } from "@shogi-games/rule-engine";
import { prisma } from "../db";
import { UsiEngine } from "../ai/usiEngine";
import { boardToSfen } from "../ai/sfen";

/**
 * トラックB Stage B改善: 自己対局の「勝敗」ではなく、やねうら王(MATERIAL_LEVEL9)の探索評価値を
 * 教師ラベルとして使う教師データを生成する(教師あり蒸留)。評価値の方が局面ごとの情報量が多く、
 * ノイズも少ないため、勝敗を教師にするより学習効率が上がると期待される。
 *
 * 使い方: npm run nnue:export-teacher-data -w apps/server -- <teacherEnginePath> [maxGames] [samplesPerGame] [byoyomiMs] [outPath]
 */

interface OutputRow {
  board: { row: number; col: number; kind: string; owner: string; promoted: boolean }[];
  hands: Record<string, Record<string, number>>;
  turn: string;
  /** turn側から見た評価値(centipawn)。 */
  evalCp: number;
}

const main = async () => {
  const teacherEnginePath = process.argv[2];
  if (!teacherEnginePath) {
    console.error("usage: exportNnueTeacherData.ts <teacherEnginePath> [maxGames] [samplesPerGame] [byoyomiMs] [outPath]");
    process.exit(1);
  }
  const maxGames = Number(process.argv[3] ?? 100000);
  const samplesPerGame = Number(process.argv[4] ?? 20);
  const byoyomiMs = Number(process.argv[5] ?? 200);
  const outPath = process.argv[6] ?? "../../ai-training/data/teacher_positions.jsonl";
  const skipOpeningPlies = 4;
  const skipEndingPlies = 2;

  const dbGames = await prisma.game.findMany({
    where: {
      status: "finished",
      resultStatus: { in: ["checkmate", "resigned", "foul_loss", "draw"] },
      isSenteCpu: true,
      isGoteCpu: true,
      ruleSetPreset: { category: "standard" },
    },
    include: { ruleSetPreset: true, moves: { orderBy: { moveNumber: "asc" } } },
    take: maxGames,
    orderBy: { createdAt: "desc" },
  });

  console.log(`[exportNnueTeacherData] found ${dbGames.length} standard self-play games, teacher=${teacherEnginePath}`);

  // Threads=1にしてCPU負荷(ファン音・発熱)を抑える。時間はかかっても良いのでピーク負荷を優先して下げる。
  const engine = new UsiEngine({ enginePath: teacherEnginePath, options: { Threads: "1" } });
  await engine.start();

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const out = fs.createWriteStream(outPath);

  let written = 0;
  let skippedGames = 0;
  const start = Date.now();

  for (let gi = 0; gi < dbGames.length; gi++) {
    const dbGame = dbGames[gi];
    try {
      const ruleSet = dbGame.ruleSetPreset.config as unknown as RuleSet;

      const usablePlies = dbGame.moves.length - skipOpeningPlies - skipEndingPlies;
      if (usablePlies <= 0) continue;

      const samplePlies = new Set<number>();
      for (let i = 0; i < samplesPerGame; i++) {
        const ply = skipOpeningPlies + Math.floor((usablePlies * i) / samplesPerGame);
        samplePlies.add(ply);
      }

      const state = new GameState(ruleSet);
      for (let i = 0; i < dbGame.moves.length; i++) {
        if (samplePlies.has(i) && state.result.status === "in_progress") {
          const sfen = boardToSfen(state.board, state.hands, state.turn);
          const { scoreCp } = await engine.evalSfen(sfen, { byoyomiMs });
          if (scoreCp !== null) {
            const board: OutputRow["board"] = [];
            for (let row = 0; row < ruleSet.boardHeight; row++) {
              for (let col = 0; col < ruleSet.boardWidth; col++) {
                const piece = state.board.get({ row, col });
                if (piece) board.push({ row, col, ...piece });
              }
            }
            const row: OutputRow = {
              board,
              hands: { sente: { ...state.hands.sente }, gote: { ...state.hands.gote } },
              turn: state.turn,
              evalCp: scoreCp,
            };
            out.write(JSON.stringify(row) + "\n");
            written++;
          }
        }

        const m = dbGame.moves[i];
        const move: Move =
          m.moveType === "move"
            ? {
                type: "move",
                from: { row: m.fromRow!, col: m.fromCol! },
                to: { row: m.toRow, col: m.toCol },
                piece: m.piece,
                promote: m.promote,
              }
            : { type: "drop", to: { row: m.toRow, col: m.toCol }, piece: m.piece };
        state.applyMove(move);
      }
    } catch (e) {
      skippedGames++;
      console.error(`[exportNnueTeacherData] failed on game ${dbGame.id}, skipping:`, e instanceof Error ? e.message : e);
    }

    if ((gi + 1) % 20 === 0) {
      const elapsed = (Date.now() - start) / 1000;
      console.log(`[exportNnueTeacherData] ${gi + 1}/${dbGames.length} games, ${written} positions, ${elapsed.toFixed(0)}s elapsed`);
    }
  }

  out.end();
  engine.stop();
  console.log(`[exportNnueTeacherData] wrote ${written} positions (${skippedGames} games skipped) to ${outPath}`);
  process.exit(0);
};

main().catch((e) => {
  console.error("[exportNnueTeacherData] fatal error:", e);
  process.exit(1);
});
