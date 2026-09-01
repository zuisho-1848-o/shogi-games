import Redis from "ioredis";
import crypto from "node:crypto";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

/** 通常のコマンド用と、socket.ioのRedis adapter(pub/sub)用で接続を分ける必要があるためそれぞれ用意する。 */
export const redis = new Redis(REDIS_URL);
export const redisSub = redis.duplicate();

const UNLOCK_SCRIPT = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

/** シンプルな分散ロック(SET NX PX)。マッチング待機列はマルチプロセスで共有するため、
 * 「読み取り→判断→書き込み」の一連の操作をプロセスをまたいで排他制御する必要がある。
 * 取得できるまで短い間隔でリトライし、一定回数で諦める(デッドロック防止)。 */
export const withLock = async <T>(lockKey: string, fn: () => Promise<T>): Promise<T> => {
  const token = crypto.randomBytes(8).toString("hex");
  const maxAttempts = 40; // 40 * 50ms = 最大2秒待つ

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const acquired = await redis.set(lockKey, token, "PX", 3000, "NX");
    if (acquired) {
      try {
        return await fn();
      } finally {
        await redis.eval(UNLOCK_SCRIPT, 1, lockKey, token);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`failed to acquire lock: ${lockKey}`);
};
