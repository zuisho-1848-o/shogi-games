import { getPieceDefinition } from "./pieceDefinitions";
import { GameResult, MoveRecord } from "./gameState";
import { RuleSet } from "./types";

const KANJI_DIGITS = ["〇", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
const ZENKAKU_DIGITS = ["０", "１", "２", "３", "４", "５", "６", "７", "８", "９"];

/** 筋(col+1)は棋譜の慣例に合わせて全角数字で表記する(手元(from)側は半角のまま)。 */
const zenkakuSuji = (n: number): string =>
  n <= 9 ? ZENKAKU_DIGITS[n] : String(n).replace(/[0-9]/g, (d) => ZENKAKU_DIGITS[Number(d)]);

/** 段(row+1)を漢数字に変換する。将棋の棋譜表記(１二三...ではなく一二三...)に合わせる。
 * 通常の将棋盤(9段以下)を想定しているが、特殊盤面向けに10段以上もそれなりに表現できるようにしてある。 */
const kanjiDan = (n: number): string => {
  if (n <= 10) return KANJI_DIGITS[n];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return (tens > 1 ? KANJI_DIGITS[tens] : "") + "十" + (ones > 0 ? KANJI_DIGITS[ones] : "");
};

const padMoveNumber = (n: number): string => String(n).padStart(4, " ");

const resultLine = (result: GameResult, moveNumber: number): string | null => {
  const n = padMoveNumber(moveNumber);
  switch (result.status) {
    case "resigned":
      return `${n} 投了`;
    case "checkmate":
      return `${n} 詰み`;
    case "foul_loss":
      return `${n} 反則負け(連続王手の千日手)`;
    case "draw":
      return result.reason === "jishogi" ? `${n} 持将棋(引き分け)` : `${n} 千日手`;
    case "jishogi_win":
      return `${n} 持将棋(入玉勝ち)`;
    default:
      return null;
  }
};

export interface KifuOptions {
  ruleSet: RuleSet;
  history: MoveRecord[];
  result: GameResult;
  sentePlayerName?: string;
  gotePlayerName?: string;
}

/** 対局の指し手履歴をKIF形式(将棋の標準的な棋譜形式)のテキストに変換する。
 * 変則ルール(特殊盤面・特殊駒)にも座標表記の考え方をそのまま拡張して対応しているが、
 * 本物の将棋ソフトのKIFパーサーが想定しているのは9x9の標準将棋・標準駒なので、
 * 変則ルールで出力したKIFを他の将棋ソフトに読み込ませられる保証はない点に注意。 */
export const generateKifuText = (options: KifuOptions): string => {
  const { ruleSet, history, result } = options;
  const lines: string[] = [];

  lines.push(`# ${ruleSet.name}の棋譜`);
  lines.push(`手合割：${ruleSet.name}`);
  lines.push(`先手：${options.sentePlayerName ?? "先手"}`);
  lines.push(`後手：${options.gotePlayerName ?? "後手"}`);
  lines.push("手数----指手---------------------");

  let prevTo: { row: number; col: number } | null = null;

  history.forEach((record, i) => {
    const moveNumber = i + 1;
    const move = record.move;
    const def = getPieceDefinition(ruleSet.pieceSet, move.piece);
    const isSameSquare = !!prevTo && move.to.row === prevTo.row && move.to.col === prevTo.col;
    const destination = isSameSquare ? "同　" : `${zenkakuSuji(move.to.col + 1)}${kanjiDan(move.to.row + 1)}`;

    let text: string;
    if (move.type === "drop") {
      text = `${destination}${def.displayName.sente}打`;
    } else {
      const from = move.from!;
      const pieceLabel = def.displayName.sente + (move.promote ? "成" : "");
      text = `${destination}${pieceLabel}(${from.col + 1}${from.row + 1})`;
    }

    lines.push(`${padMoveNumber(moveNumber)} ${text}`);
    prevTo = move.to;
  });

  const finalLine = resultLine(result, history.length + 1);
  if (finalLine) lines.push(finalLine);

  return lines.join("\n") + "\n";
};
