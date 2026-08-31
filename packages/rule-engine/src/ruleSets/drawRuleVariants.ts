import { RuleSet } from "../types";
import { STANDARD_RULE_SET } from "./standard";

/** 標準ルール+持将棋(27点法)。両者の玉が入玉した状態で、27点以上ある側が勝ち抜け(両者27点以上なら引き分け)。 */
export const JISHOGI_27_RULE_SET: RuleSet = {
  ...STANDARD_RULE_SET,
  id: "jishogi_27",
  name: "持将棋(27点法)あり将棋",
  drawConditions: {
    ...STANDARD_RULE_SET.drawConditions,
    jishogi27: true,
  },
};

/** 千日手判定なし(何度でも同一局面を繰り返せる)のカジュアル版。手軽に無限に遊びたい人向け。 */
export const NO_SENNICHITE_RULE_SET: RuleSet = {
  ...STANDARD_RULE_SET,
  id: "no_sennichite",
  name: "千日手判定なし将棋",
  drawConditions: {
    ...STANDARD_RULE_SET.drawConditions,
    sennichite: false,
  },
};

export const DRAW_RULE_VARIANT_RULE_SETS = [JISHOGI_27_RULE_SET, NO_SENNICHITE_RULE_SET];
