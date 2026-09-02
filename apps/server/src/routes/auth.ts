import { Router } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../db";
import { getUserIdFromRequest, signToken } from "../auth";
import { asyncHandler } from "../asyncHandler";

export const authRouter = Router();

const PASSWORD_MIN_LENGTH = 8;

const publicUser = (user: { id: string; name: string; rating: number; isAi: boolean; gamesPlayed: number }) => ({
  id: user.id,
  name: user.name,
  rating: user.rating,
  isAi: user.isAi,
  gamesPlayed: user.gamesPlayed,
});

authRouter.post("/register", asyncHandler(async (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";

  if (!name || !email || password.length < PASSWORD_MIN_LENGTH) {
    res.status(400).json({ error: "invalid_input", message: `名前・メールアドレス必須、パスワードは${PASSWORD_MIN_LENGTH}文字以上` });
    return;
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    res.status(409).json({ error: "email_taken" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({ data: { name, email, passwordHash } });

  res.json({ token: signToken(user.id), user: publicUser(user) });
}));

authRouter.post("/login", asyncHandler(async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";

  const user = email ? await prisma.user.findUnique({ where: { email } }) : null;
  if (!user || !user.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
    res.status(401).json({ error: "invalid_credentials" });
    return;
  }

  res.json({ token: signToken(user.id), user: publicUser(user) });
}));

authRouter.get("/me", asyncHandler(async (req, res) => {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    res.status(401).json({ error: "not_authenticated" });
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    res.status(404).json({ error: "user_not_found" });
    return;
  }

  res.json({ user: publicUser(user) });
}));
