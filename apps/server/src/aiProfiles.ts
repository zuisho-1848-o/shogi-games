import { prisma } from "./db";

export interface AiProfile {
  slug: string;
  name: string;
  /** 探索深さ(反復深化の上限)。 */
  maxDepth: number;
  /** 1手あたりの思考時間予算(ミリ秒)。 */
  timeBudgetMs: number;
}

/** サーバー内蔵AIの強さプリセット。強くするほどdepth/timeBudgetを上げる。
 * それぞれ独立したUserアカウント(isAi:true)としてDBに登録し、個別にレーティングを持たせる。 */
export const AI_PROFILES: AiProfile[] = [
  { slug: "ai_easy", name: "AI初級", maxDepth: 2, timeBudgetMs: 300 },
  { slug: "ai_medium", name: "AI中級", maxDepth: 4, timeBudgetMs: 1200 },
  { slug: "ai_hard", name: "AI上級", maxDepth: 6, timeBudgetMs: 3000 },
  { slug: "ai_expert", name: "AI最強", maxDepth: 8, timeBudgetMs: 6000 },
];

const emailFor = (slug: string) => `${slug}@bot.local`;

/** slug -> DB上のUser.id */
export const AI_USER_IDS = new Map<string, string>();
/** User.id -> slug (復元処理などで「このuserIdはどのAIプロファイルか」を逆引きするため) */
export const AI_USER_ID_TO_SLUG = new Map<string, string>();

export const getAiProfileBySlug = (slug: string): AiProfile | undefined =>
  AI_PROFILES.find((p) => p.slug === slug);

export const getAiProfileByUserId = (userId: string): AiProfile | undefined => {
  const slug = AI_USER_ID_TO_SLUG.get(userId);
  return slug ? getAiProfileBySlug(slug) : undefined;
};

/** 起動時に呼ぶ。AIボット用のUser行が無ければ作成し、slug→userIdのマップを組み立てる。
 * emailを安定したキーとして使うことで、再起動をまたいでも同じアカウント(=レーティング)を使い回せるようにしている。 */
export const ensureAiProfileUsers = async (): Promise<void> => {
  for (const profile of AI_PROFILES) {
    const email = emailFor(profile.slug);
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      AI_USER_IDS.set(profile.slug, existing.id);
      AI_USER_ID_TO_SLUG.set(existing.id, profile.slug);
      continue;
    }
    const created = await prisma.user.create({
      data: { name: profile.name, email, isAi: true, passwordHash: null },
    });
    AI_USER_IDS.set(profile.slug, created.id);
    AI_USER_ID_TO_SLUG.set(created.id, profile.slug);
  }
  console.log(`registered ${AI_USER_IDS.size} AI bot profile(s)`);
};
