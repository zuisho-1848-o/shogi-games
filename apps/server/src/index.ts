import "dotenv/config"; // apps/server/.env を読み込む(JWT_SECRET, WEB_ORIGIN, REDIS_URL等)。他のimportより先に実行する必要がある。
import cors from "cors";
import express, { NextFunction, Request, Response } from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { gamesRouter } from "./routes/games";
import { authRouter } from "./routes/auth";
import { usersRouter } from "./routes/users";
import { puzzlesRouter } from "./routes/puzzles";
import { registerGameSocket } from "./socket/gameSocket";
import { registerMatchSocket } from "./socket/matchSocket";
import { restoreGamesFromDb } from "./restore";
import { ensureAiProfileUsers } from "./aiProfiles";
import { startMatchQueueSweeper } from "./matchQueue";
import { redis, redisSub } from "./redisClient";
import { authRateLimiter } from "./rateLimit";
import { loadTunedWeightsIfPresent } from "./ai/weights";

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:3000";

const app = express();
// 本番はNginxのリバースプロキシ配下で動かす想定。X-Forwarded-*ヘッダを信頼しないと
// クライアントIPやプロトコル(https)の判定がおかしくなる(レート制限のIP判定にも影響する)。
app.set("trust proxy", 1);
app.use(cors({ origin: WEB_ORIGIN }));
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));
app.use("/api/auth", authRateLimiter, authRouter);
app.use("/api/users", usersRouter);
app.use("/api/games", gamesRouter);
app.use("/api/puzzles", puzzlesRouter);

// asyncHandlerで囲んだルートハンドラの例外はここに集約される(素のExpress 4はasyncの例外を自動で
// 拾わないため、asyncHandlerがnext(err)経由でここに渡す)。何もしないと素のExpressのデフォルト挙動
// (HTMLエラーページを返すだけ)になり、レスポンス形式が不揃いになるので、ここでJSON化しておく。
// eslint的には4引数のミドルウェアは常にこの位置(全ルート登録の後)である必要がある。
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  console.error(`[express] unhandled error on ${req.method} ${req.path}:`, err);
  if (res.headersSent) return;
  res.status(500).json({ error: "internal_error" });
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: WEB_ORIGIN },
});
// マッチング待機列をRedisで複数プロセス間共有するのに合わせて、socket.io自体もRedis adapterで
// クラスタ対応しておく。これによりio.to(socketId)が「そのソケットがどのプロセスに繋がっていても」届くようになる。
io.adapter(createAdapter(redis, redisSub));

registerGameSocket(io);
registerMatchSocket(io);

const boot = async () => {
  loadTunedWeightsIfPresent();
  // AIボットのUserアカウントを先に用意してから、それに依存する対局復元処理を行う。
  await ensureAiProfileUsers();
  await restoreGamesFromDb();
  startMatchQueueSweeper();
};

boot()
  .catch((e) => console.error("failed to initialize server", e))
  .finally(() => {
    httpServer.listen(PORT, () => {
      console.log(`server listening on :${PORT}`);
    });
  });

// 最後の砦: ここまでの個別対応(socket handlerのtry/catch、asyncHandler)で拾いきれなかった
// 想定外の例外でプロセス全体が落ちて進行中の全対局が巻き添えになるのを防ぐ。本来はエラーの発生源ごとに
// 個別対応すべきだが、未知の経路が今後も出てくる可能性を考え、最終防衛ラインとしてログのみ出して継続する。
process.on("unhandledRejection", (reason) => {
  console.error("[process] unhandled rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[process] uncaught exception:", err);
});
