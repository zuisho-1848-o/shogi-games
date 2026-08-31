import { Move } from "@shogi-games/rule-engine";
import { pieceLabel } from "./pieceLabels";

/** 棋譜風の簡易表記(全角数字の筋+半角の段)。KIF出力ほど厳密ではないが一覧表示用には十分。 */
export const formatMove = (move: Move | null): string => {
  if (!move) return "-";
  const suji = move.to.col + 1;
  const dan = move.to.row + 1;
  const dest = `${suji}${dan}`;
  if (move.type === "drop") return `${dest}${pieceLabel(move.piece)}打`;
  return `${dest}${pieceLabel(move.piece)}${move.promote ? "成" : ""}`;
};
