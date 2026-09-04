import "dotenv/config";
import { GameState, getRuleSetById, Move } from "@shogi-games/rule-engine";
import { UsiEngine } from "../ai/usiEngine";
import { boardToSfen, usiMoveToMove } from "../ai/sfen";

/**
 * トラックB Stage Aの効果検証用: 2つのUSIエンジン(バイナリ)を対局させ、勝率を比較する。
 * `npx tsx src/scripts/benchmarkEngines.ts <engineA path> <engineB path> [games] [byoyomiMs]`
 * 先後を交互に入れ替えながらgames局(デフォルト20)対局させ、勝敗を集計する。
 */

const MAX_PLIES = 400;

const playOneGame = async (
  engineSente: UsiEngine,
  engineGote: UsiEngine,
  byoyomiMs: number
): Promise<{ status: string; winner?: "sente" | "gote" }> => {
  const ruleSet = getRuleSetById("standard");
  const state = new GameState(ruleSet);

  while (state.result.status === "in_progress" && state.history.length < MAX_PLIES) {
    const engine = state.turn === "sente" ? engineSente : engineGote;
    const sfen = boardToSfen(state.board, state.hands, state.turn);
    const bestmove = await engine.goSfen(sfen, { byoyomiMs });

    if (bestmove === "resign" || bestmove === "win") {
      state.resign(state.turn);
      break;
    }

    let move: Move;
    try {
      move = usiMoveToMove(bestmove);
    } catch {
      console.error(`[benchmark] failed to parse bestmove "${bestmove}", treating as resign`);
      state.resign(state.turn);
      break;
    }
    if (move.type === "move" && move.from) {
      const piece = state.board.get(move.from);
      if (!piece) {
        console.error(`[benchmark] engine returned move from empty square (${bestmove}), treating as resign`);
        state.resign(state.turn);
        break;
      }
      move.piece = piece.kind;
    }
    state.applyMove(move);
  }

  if (state.result.status === "in_progress") return { status: "max_plies" };
  return { status: state.result.status, winner: "winner" in state.result ? state.result.winner : undefined };
};

const main = async () => {
  const [pathA, pathB, gamesArg, byoyomiArg] = process.argv.slice(2);
  if (!pathA || !pathB) {
    console.error("usage: benchmarkEngines.ts <engineA path> <engineB path> [games] [byoyomiMs]");
    process.exit(1);
  }
  const games = gamesArg ? Number(gamesArg) : 20;
  const byoyomiMs = byoyomiArg ? Number(byoyomiArg) : 1000;

  const engineA = new UsiEngine({ enginePath: pathA });
  const engineB = new UsiEngine({ enginePath: pathB });
  await engineA.start();
  await engineB.start();

  let aWins = 0;
  let bWins = 0;
  let draws = 0;

  for (let i = 0; i < games; i++) {
    const aIsSente = i % 2 === 0;
    const sente = aIsSente ? engineA : engineB;
    const gote = aIsSente ? engineB : engineA;
    const start = Date.now();
    const result = await playOneGame(sente, gote, byoyomiMs);

    let outcome: "A" | "B" | "draw";
    if (result.winner === "sente") outcome = aIsSente ? "A" : "B";
    else if (result.winner === "gote") outcome = aIsSente ? "B" : "A";
    else outcome = "draw";

    if (outcome === "A") aWins++;
    else if (outcome === "B") bWins++;
    else draws++;

    console.log(
      `[benchmark] game ${i + 1}/${games}: A=${aIsSente ? "sente" : "gote"} -> ${result.status}(${result.winner ?? "draw"}) winner=${outcome} ${((Date.now() - start) / 1000).toFixed(1)}s`
    );
  }

  console.log(`\n[benchmark] === result over ${games} games (byoyomi=${byoyomiMs}ms) ===`);
  console.log(`A (${pathA}): ${aWins} wins`);
  console.log(`B (${pathB}): ${bWins} wins`);
  console.log(`draws/max_plies: ${draws}`);

  engineA.stop();
  engineB.stop();
  process.exit(0);
};

main().catch((e) => {
  console.error("[benchmark] fatal error:", e);
  process.exit(1);
});
