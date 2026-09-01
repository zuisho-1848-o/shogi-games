import { Router } from "express";
import { Move } from "@shogi-games/rule-engine";
import { prisma } from "../db";
import { attemptPuzzleMove, PuzzleSnapshot } from "../puzzles";

export const puzzlesRouter = Router();

/** 一覧。mateLengthで絞り込み可能(?mateLength=3)。 */
puzzlesRouter.get("/", async (req, res) => {
  const mateLength = req.query.mateLength ? Number(req.query.mateLength) : undefined;
  const puzzles = await prisma.puzzle.findMany({
    where: mateLength ? { mateLength } : undefined,
    include: { ruleSetPreset: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  res.json({
    puzzles: puzzles.map((p) => ({
      id: p.id,
      ruleSetName: p.ruleSetPreset.name,
      mateLength: p.mateLength,
      occurrenceCount: p.occurrenceCount,
    })),
  });
});

puzzlesRouter.get("/:id", async (req, res) => {
  const puzzle = await prisma.puzzle.findUnique({ where: { id: req.params.id }, include: { ruleSetPreset: true } });
  if (!puzzle) {
    res.status(404).json({ error: "puzzle_not_found" });
    return;
  }
  const snapshot = puzzle.snapshot as unknown as PuzzleSnapshot;
  res.json({
    id: puzzle.id,
    ruleSetName: puzzle.ruleSetPreset.name,
    boardWidth: (puzzle.ruleSetPreset.config as { boardWidth: number }).boardWidth,
    boardHeight: (puzzle.ruleSetPreset.config as { boardHeight: number }).boardHeight,
    snapshot,
    mateLength: puzzle.mateLength,
    occurrenceCount: puzzle.occurrenceCount,
  });
});

/** 攻め方の一手を提出する。movesSoFarはこれまでにこの問題で(攻め方・受け方交互に)確定した手の履歴。 */
puzzlesRouter.post("/:id/attempt", async (req, res) => {
  try {
    const movesSoFar = (req.body?.movesSoFar ?? []) as Move[];
    const candidateMove = req.body?.move as Move;
    if (!candidateMove) {
      res.status(400).json({ error: "move_required" });
      return;
    }
    const result = await attemptPuzzleMove(req.params.id, movesSoFar, candidateMove);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});
