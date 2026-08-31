import { SERVER_URL } from "./api";

export interface RuleSetMeta {
  id: string;
  name: string;
  category: "standard" | "handicap" | "special" | "boardSize";
  description: string;
}

export const fetchRuleSets = async (): Promise<RuleSetMeta[]> => {
  const res = await fetch(`${SERVER_URL}/api/games/rule-sets`);
  if (!res.ok) throw new Error("failed to fetch rule sets");
  const data = await res.json();
  return data.ruleSets;
};

export const CATEGORY_LABEL: Record<RuleSetMeta["category"], string> = {
  standard: "標準",
  handicap: "駒落ち",
  special: "特殊ルール",
  boardSize: "特殊盤面",
};
