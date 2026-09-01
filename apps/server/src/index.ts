import "dotenv/config"; // apps/server/.env を読み込む(JWT_SECRET, WEB_ORIGIN, REDIS_URL等)。他のimportより先に実行する必要がある。
import cors from "cors";
import express from "express";
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
