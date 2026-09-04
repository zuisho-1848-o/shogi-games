import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { GameState, Move, Player, RuleSet } from "@shogi-games/rule-engine";
import { prisma } from "../db";

/**
 * トラックB Stage B: 自前学習NNUE用の教師データをDBの自己対局から書き出す。
 * HalfKP特徴量は標準将棋(9x9・標準駒)専用のエンコーディングなので、ruleSetId==="standard"の
 * 対局だけを対象にする(5x5/7x7/駒落ち等は駒構成・盤サイズが異なるため今回は対象外)。
 * 出力はJSONL(1行1局面)。Python側(ai-training/)で読み込んで学習に使う。
 */

interface OutputRow {
  board: { row: number; col: number; kind: string; owner: Player; promoted: boolean }[];
  hands: Record<Player, Record<string, number>>;
  turn: Player;
  /** turn側から見た最終結果。1=turn側が勝った、0=負けた、0.5=引き分け。 */
  outcome: number;
}

const main = async () => {
  const maxGames = Number(process.argv[2] ?? 100000);
  const samplesPerGame = Number(process.argv[3] ?? 10);
  const outPath = process.argv[4] ?? "../../ai-training/data/positions.jsonl";
  const skipOpeningPlies = 6;
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

  console.log(`[exportNnueTrainingData] found ${dbGames.length} standard self-play games`);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const out = fs.createWriteStream(outPath);

  let written = 0;
  let skippedGames = 0;

  for (const dbGame of dbGames) {
    try {
      const ruleSet = dbGame.ruleSetPreset.config as unknown as RuleSet;
      const outcomeForSente = dbGame.winner === "sente" ? 1 : dbGame.winner === "gote" ? 0 : 0.5;

      const usablePlies = dbGame.moves.length - skipOpeningPlies - skipEndingPlies;
      if (usablePlies <= 0) continue;

      const samplePlies = new Set<number>();
      for (let i = 0; i < samplesPerGame; i++) {
        const ply = skipOpeningPlies + Math.floor((usablePlies * i) / samplesPerGame);
        samplePlies.add(ply);
      }

      const state = new GameState(ruleSet);
      for (let i = 0; i < dbGame.moves.length; i++) {
        if (samplePlies.has(i)) {
          const outcomeForTurn = state.turn === "sente" ? outcomeForSente : 1 - outcomeForSente;
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
            outcome: outcomeForTurn,
          };
          out.write(JSON.stringify(row) + "\n");
          written++;
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
      console.error(`[exportNnueTrainingData] failed to replay game ${dbGame.id}, skipping:`, e instanceof Error ? e.message : e);
    }
  }

  out.end();
  console.log(`[exportNnueTrainingData] wrote ${written} positions (${skippedGames} games skipped) to ${outPath}`);
};

main().catch((e) => {
  console.error("[exportNnueTrainingData] fatal error:", e);
  process.exit(1);
});
