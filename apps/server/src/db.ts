import { getPrisma } from "@shogi-games/db";
import { RULE_SET_METADATA, RuleSet } from "@shogi-games/rule-engine";

const prisma = getPrisma();

const presetIdCache = new Map<string, string>();

/** RuleSet(engine側)のidに対応するDB上のRuleSetPreset行がなければ作成し、そのidを返す。
 * config列にRuleSet全体をJsonで保存しておくことで、対局履歴からどのルールで指したか再現できるようにする。
 * カスタム自由配置(id: custom_*)は毎回ユニークなidなのでキャッシュせず常に新規行を作る。 */
export const ensureRuleSetPreset = async (ruleSet: RuleSet): Promise<string> => {
  const isCustom = ruleSet.id.startsWith("custom_");

  if (!isCustom) {
    const cached = presetIdCache.get(ruleSet.id);
    if (cached) return cached;

    const existing = await prisma.ruleSetPreset.findFirst({ where: { name: ruleSet.name } });
    if (existing) {
      presetIdCache.set(ruleSet.id, existing.id);
      return existing.id;
    }
  }

  const meta = RULE_SET_METADATA.find((m) => m.id === ruleSet.id);
  const created = await prisma.ruleSetPreset.create({
    data: {
      name: isCustom ? `${ruleSet.name}(${ruleSet.id})` : ruleSet.name,
      category: meta?.category ?? (isCustom ? "special" : "standard"),
      config: ruleSet as unknown as object,
      isPublic: !isCustom,
    },
  });

  if (!isCustom) presetIdCache.set(ruleSet.id, created.id);
  return created.id;
};

export { prisma };
