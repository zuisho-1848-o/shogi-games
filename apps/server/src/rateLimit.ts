import rateLimit from "express-rate-limit";

/** 認証系(登録・ログイン): 総当たり攻撃・大量アカウント作成を防ぐため厳しめに制限する。 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "しばらく時間をおいてから再度お試しください" },
});

/** 対局作成系(CPU戦・プライベートマッチ・AI同士対局・自己対局バッチ): 連投による過負荷を防ぐ。
 * 自己対局バッチは重い処理だが、count自体に上限(20)を設けているのでここでは通常のAPI呼び出し回数の制限のみ行う。 */
export const gameCreationRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "対局の作成が短時間に集中しています。少し待ってから再度お試しください" },
});

/** Socket.ioイベント用の簡易レート制限。プロセスローカルのメモリで管理する(マルチプロセス化する場合は
 * Redis等への移行が必要。単一プロセス運用の現状ではこれで十分)。
 * key(通常はsocket.id + イベント種別)ごとに直近windowMs内の呼び出し回数を数え、上限を超えたらfalseを返す。 */
const socketCallLog = new Map<string, number[]>();

export const checkSocketRateLimit = (key: string, limit: number, windowMs: number): boolean => {
  const now = Date.now();
  const timestamps = (socketCallLog.get(key) ?? []).filter((t) => now - t < windowMs);
  if (timestamps.length >= limit) {
    socketCallLog.set(key, timestamps);
    return false;
  }
  timestamps.push(now);
  socketCallLog.set(key, timestamps);
  return true;
};

/** 切断済みソケットの記録を掃除する(メモリリーク防止)。 */
export const clearSocketRateLimit = (socketId: string): void => {
  for (const key of socketCallLog.keys()) {
    if (key.startsWith(`${socketId}:`)) socketCallLog.delete(key);
  }
};
