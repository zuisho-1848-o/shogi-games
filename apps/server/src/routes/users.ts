import { Router } from "express";
import { prisma } from "../db";

export const usersRouter = Router();

/** レーティング一覧。type=humanなら人間だけ、type=aiならAIボットだけ(プールを分けて表示)。 */
usersRouter.get("/leaderboard", async (req, res) => {
  const isAi = req.query.type === "ai";
  const users = await prisma.user.findMany({
    where: { isAi },
    orderBy: { rating: "desc" },
    take: 50,
    select: { id: true, name: true, rating: true, gamesPlayed: true, isAi: true },
  });
  res.json({ users });
});
