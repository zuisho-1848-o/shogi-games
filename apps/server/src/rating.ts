import { prisma } from "./db";

const K_FACTOR = 32;

/** 標準的なEloレーティング更新。score: 勝ち=1, 分け=0.5, 負け=0。 */
export const computeEloDelta = (ratingSelf: number, ratingOpponent: number, score: number): number => {
  const expected = 1 / (1 + 10 ** ((ratingOpponent - ratingSelf) / 400));
  return Math.round(K_FACTOR * (score - expected));
};

/** 対局結果からsente/goteのレーティングを更新する。両者ともUserアカウントに紐づいている対局のみが対象
 * (ゲストプレイや片方だけログインしている対局はレーティング変動なし)。 */
export const applyRatingUpdate = async (params: {
  senteUserId: string;
  goteUserId: string;
  senteScore: number; // 1=先手勝ち, 0.5=引き分け, 0=先手負け
}): Promise<void> => {
  const [sente, gote] = await Promise.all([
    prisma.user.findUnique({ where: { id: params.senteUserId } }),
    prisma.user.findUnique({ where: { id: params.goteUserId } }),
  ]);
  if (!sente || !gote) return;

  const senteDelta = computeEloDelta(sente.rating, gote.rating, params.senteScore);
  const goteDelta = computeEloDelta(gote.rating, sente.rating, 1 - params.senteScore);

  await Promise.all([
    prisma.user.update({
      where: { id: sente.id },
      data: { rating: sente.rating + senteDelta, gamesPlayed: { increment: 1 } },
    }),
    prisma.user.update({
      where: { id: gote.id },
      data: { rating: gote.rating + goteDelta, gamesPlayed: { increment: 1 } },
    }),
  ]);
};
