import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { gamesRouter } from "./routes/games";
import { authRouter } from "./routes/auth";
import { usersRouter } from "./routes/users";
import { registerGameSocket } from "./socket/gameSocket";
import { registerMatchSocket } from "./socket/matchSocket";
import { restoreGamesFromDb } from "./restore";
import { ensureAiProfileUsers } from "./aiProfiles";

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:3000";

const app = express();
app.use(cors({ origin: WEB_ORIGIN }));
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));
app.use("/api/auth", authRouter);
app.use("/api/users", usersRouter);
app.use("/api/games", gamesRouter);

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: WEB_ORIGIN },
});

registerGameSocket(io);
registerMatchSocket(io);

const boot = async () => {
  // AIボットのUserアカウントを先に用意してから、それに依存する対局復元処理を行う。
  await ensureAiProfileUsers();
  await restoreGamesFromDb();
};

boot()
  .catch((e) => console.error("failed to initialize server", e))
  .finally(() => {
    httpServer.listen(PORT, () => {
      console.log(`server listening on :${PORT}`);
    });
  });
