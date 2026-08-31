import { Request } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret-change-me-in-production";
const JWT_EXPIRES_IN = "30d";

export interface AuthPayload {
  userId: string;
}

export const signToken = (userId: string): string => jwt.sign({ userId } satisfies AuthPayload, JWT_SECRET, {
  expiresIn: JWT_EXPIRES_IN,
});

export const verifyToken = (token: string): AuthPayload | null => {
  try {
    return jwt.verify(token, JWT_SECRET) as AuthPayload;
  } catch {
    return null;
  }
};

/** Authorizationヘッダ("Bearer <token>")からログイン中のuserIdを取り出す。未ログインならnull。
 * ゲスト対局(未ログイン)は引き続きサポートするため、認証必須にはしていない。 */
export const getUserIdFromRequest = (req: Request): string | null => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length);
  return verifyToken(token)?.userId ?? null;
};
