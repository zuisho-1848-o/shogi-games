import { RuleSet } from "../types";
import { STANDARD_RULE_SET } from "./standard";

const replaceKingWithLion = (pieces: typeof STANDARD_RULE_SET.initialSetup.sente.pieces) =>
  pieces.map((p) => (p.kind === "king" ? { ...p, kind: "lion" } : p));

/** 獅子王将棋: 王将の代わりに獅子(中将棋由来、8方向1マス+2マス先までのジャンプが可能)を大将として使うバリアント。
 * 獅子が詰まされたら通常の詰みと同じ扱いで負け。 */
export const LION_KING_RULE_SET: RuleSet = {
  ...STANDARD_RULE_SET,
  id: "lion_king",
  name: "獅子王将棋",
  initialSetup: {
    sente: { pieces: replaceKingWithLion(STANDARD_RULE_SET.initialSetup.sente.pieces) },
    gote: { pieces: replaceKingWithLion(STANDARD_RULE_SET.initialSetup.gote.pieces) },
  },
};
