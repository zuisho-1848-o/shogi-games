import { RuleSet } from "../types";
import { STANDARD_RULE_SET } from "./standard";
import { HANDICAP_RULE_SETS } from "./handicap";
import { TORU_ITTATE_RULE_SET } from "./toruIttate";
import { MINI_BOARD_RULE_SETS } from "./miniBoards";
import { LION_KING_RULE_SET } from "./lionKing";
import { SHOGI_VS_GO_RULE_SET } from "./shogiVsGo";
import { JISHOGI_27_RULE_SET, NO_SENNICHITE_RULE_SET } from "./drawRuleVariants";
import { FORCED_PROMOTION_RULE_SET, SEVEN_BY_SEVEN_RULE_SET } from "./moreVariants";

export type RuleSetCategory = "standard" | "handicap" | "special" | "boardSize";

export interface RuleSetMeta {
  id: string;
  name: string;
  category: RuleSetCategory;
  description: string;
}

const withCategory = (ruleSet: RuleSet, category: RuleSetCategory, description: string): RuleSetMeta => ({
  id: ruleSet.id,
  name: ruleSet.name,
  category,
  description,
});

export const BUILT_IN_RULE_SETS: RuleSet[] = [
  STANDARD_RULE_SET,
  ...HANDICAP_RULE_SETS,
  TORU_ITTATE_RULE_SET,
  ...MINI_BOARD_RULE_SETS,
  LION_KING_RULE_SET,
  SHOGI_VS_GO_RULE_SET,
  JISHOGI_27_RULE_SET,
  NO_SENNICHITE_RULE_SET,
  FORCED_PROMOTION_RULE_SET,
  SEVEN_BY_SEVEN_RULE_SET,
];

export const RULE_SET_REGISTRY: Record<string, RuleSet> = Object.fromEntries(
  BUILT_IN_RULE_SETS.map((rs) => [rs.id, rs])
);

export const getRuleSetById = (id: string): RuleSet => {
  const rs = RULE_SET_REGISTRY[id];
  if (!rs) throw new Error(`Unknown ruleSet id: ${id}`);
  return rs;
};

export const RULE_SET_METADATA: RuleSetMeta[] = [
  withCategory(STANDARD_RULE_SET, "standard", "9x9の通常将棋ルール"),
  withCategory(HANDICAP_RULE_SETS[0], "handicap", "後手の右香を落とす"),
  withCategory(HANDICAP_RULE_SETS[1], "handicap", "後手の角を落とす"),
  withCategory(HANDICAP_RULE_SETS[2], "handicap", "後手の飛車を落とす"),
  withCategory(HANDICAP_RULE_SETS[3], "handicap", "後手の飛車と香を落とす"),
  withCategory(HANDICAP_RULE_SETS[4], "handicap", "後手の飛車と角を落とす"),
  withCategory(HANDICAP_RULE_SETS[5], "handicap", "後手の飛車・角・桂2枚を落とす"),
  withCategory(HANDICAP_RULE_SETS[6], "handicap", "後手の飛車・角・桂2枚・香2枚を落とす"),
  withCategory(HANDICAP_RULE_SETS[7], "handicap", "先手・後手で異なる駒を落とし合う"),
  withCategory(TORU_ITTATE_RULE_SET, "special", "駒が取れるときは取らなければならない(王手放置になる場合を除く)"),
  withCategory(MINI_BOARD_RULE_SETS[0], "boardSize", "5x5の小型盤面。オリジナル駒配置"),
  withCategory(MINI_BOARD_RULE_SETS[1], "boardSize", "3x3、王と金2枚のみの超ミニ対局"),
  withCategory(
    LION_KING_RULE_SET,
    "special",
    "王将の代わりに獅子(8方向1マス+2マス先までジャンプ可能)を使う中将棋由来のバリアント"
  ),
  withCategory(
    SHOGI_VS_GO_RULE_SET,
    "special",
    "実験的バリアント。先手は通常の将棋一式、後手は王のみ+大量の石(打つだけで動かせない駒)で対局する非対称ルール"
  ),
  withCategory(JISHOGI_27_RULE_SET, "special", "標準ルール+持将棋(27点法)。両者入玉時に駒点で決着をつけられる"),
  withCategory(NO_SENNICHITE_RULE_SET, "special", "標準ルール+千日手判定なし。同一局面を何度でも繰り返せるカジュアル版"),
  withCategory(FORCED_PROMOTION_RULE_SET, "special", "成れる場面では必ず成る。テンポの速い攻め合いになる"),
  withCategory(SEVEN_BY_SEVEN_RULE_SET, "boardSize", "7x7の中型盤面。香・桂を含むオリジナル配置"),
];
