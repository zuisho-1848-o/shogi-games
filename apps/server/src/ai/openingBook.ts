import { Move, RuleSet } from "@shogi-games/rule-engine";

/** ごく小さな定跡集。標準将棋の「初手」だけを対象にした簡易実装。
 * 探索よりも定跡の方が質が高い(かつAIが毎回同じ初手を指すのを避けたい)序盤の入り口だけを担当し、
 * それ以降は通常の探索に任せる。本格的な定跡データベース化はAI Stage 2の残課題として明記している。 */

// 内部座標: row0=後手側最奥, col0=盤面右端(将棋の1筋)。
// ２六歩・７六歩・５六歩という代表的な初手を、先手基準(row6→row5)の歩の一マス前進として表現する。
const STANDARD_FIRST_MOVES: Move[] = [
  { type: "move", from: { row: 6, col: 1 }, to: { row: 5, col: 1 }, piece: "pawn", promote: false }, // ２六歩
  { type: "move", from: { row: 6, col: 6 }, to: { row: 5, col: 6 }, piece: "pawn", promote: false }, // ７六歩
  { type: "move", from: { row: 6, col: 4 }, to: { row: 5, col: 4 }, piece: "pawn", promote: false }, // ５六歩
];

/** historyが空(=このプレイヤーにとって初手)かつ標準将棋の場合のみ、定跡から1手選んで返す。
 * それ以外はnullを返し、呼び出し側は通常の探索にフォールバックする。 */
export const pickOpeningBookMove = (ruleSet: RuleSet, moveCountSoFar: number): Move | null => {
  if (ruleSet.id !== "standard" || moveCountSoFar !== 0) return null;
  return STANDARD_FIRST_MOVES[Math.floor(Math.random() * STANDARD_FIRST_MOVES.length)];
};
