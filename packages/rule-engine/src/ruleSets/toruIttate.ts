import { RuleSet } from "../types";
import { STANDARD_RULE_SET } from "./standard";

/** 取る一手将棋: 駒を取れる手がある場合は必ず取らなければならない(王手放置になる手は除く)。 */
export const TORU_ITTATE_RULE_SET: RuleSet = {
  ...STANDARD_RULE_SET,
  id: "toru_ittate",
  name: "取る一手将棋",
  captureRule: {
    mandatoryCapture: true,
    ignoreIfLeavesKingInCheck: true,
  },
};
