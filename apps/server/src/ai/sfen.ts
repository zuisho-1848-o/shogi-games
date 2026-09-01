import { Board, Move, Player, Square } from "@shogi-games/rule-engine";

/**
 * SFEN(Shogi Forsyth-Edwards Notation)変換。標準ルール(9x9・標準駒)専用。
 * 内部座標は row0=後手側最奥段、col0=盤面右端(1筋)。
 * SFEN文字列は「1段目(後手側最奥)〜9段目」を上から並べ、各段は「9筋〜1筋」の順に書く。
 * つまり内部の(row, col)は SFEN上の rank=row, file=(9-col) に対応し、
 * 段内の文字位置(0始まり)は (8 - col) となる。
 */

const USI_LETTER: Record<string, string> = {
  pawn: "P",
  lance: "L",
  knight: "N",
  silver: "S",
  gold: "G",
  bishop: "B",
  rook: "R",
  king: "K",
};
const LETTER_TO_KIND: Record<string, string> = Object.fromEntries(
  Object.entries(USI_LETTER).map(([kind, letter]) => [letter, kind])
);
/** 手駒として打てる順(USI慣習上の並びに寄せているだけで必須ではない) */
const HAND_ORDER = ["rook", "bishop", "gold", "silver", "knight", "lance", "pawn"];

// boardToSfen()の生成結果を正解のSFEN初期局面と突き合わせて検証したところ、file=col+1が正しい対応と判明
// (以前は9-colとしており、指し手1マスだけを変換するこちらの式が逆になっていたため指し手の変換だけが壊れていた)。
const fileFromCol = (col: number): number => col + 1; // suji(筋)
const colFromFile = (file: number): number => file - 1;
const rankFromRow = (row: number): number => row + 1; // dan(段) 1-9
const rowFromRank = (rank: number): number => rank - 1;

export const boardToSfen = (
  board: Board,
  hands: Record<Player, Record<string, number>>,
  turn: Player
): string => {
  const rows: string[] = [];
  for (let row = 0; row < 9; row++) {
    let rank = "";
    let empty = 0;
    for (let col = 8; col >= 0; col--) {
      const piece = board.get({ row, col });
      if (!piece) {
        empty++;
        continue;
      }
      if (empty > 0) {
        rank += empty;
        empty = 0;
      }
      const letter = USI_LETTER[piece.kind];
      if (!letter) throw new Error(`sfen: unsupported piece kind "${piece.kind}"`);
      const promoted = piece.promoted ? "+" : "";
      rank += promoted + (piece.owner === "sente" ? letter : letter.toLowerCase());
    }
    if (empty > 0) rank += empty;
    rows.push(rank);
  }

  const handStr = (["sente", "gote"] as Player[])
    .map((player) =>
      HAND_ORDER.map((kind) => {
        const count = hands[player]?.[kind] ?? 0;
        if (count <= 0) return "";
        const letter = USI_LETTER[kind];
        const withCount = count > 1 ? `${count}${letter}` : letter;
        return player === "sente" ? withCount : withCount.toLowerCase();
      }).join("")
    )
    .join("");

  const turnLetter = turn === "sente" ? "b" : "w";
  return `${rows.join("/")} ${turnLetter} ${handStr || "-"} 1`;
};

/** USIの指し手表記(例: "7g7f", "8h2b+", "P*5e")を内部Moveに変換する。 */
export const usiMoveToMove = (usi: string): Move => {
  if (usi.includes("*")) {
    const [pieceLetter, toStr] = usi.split("*");
    const kind = LETTER_TO_KIND[pieceLetter.toUpperCase()];
    if (!kind) throw new Error(`sfen: unsupported drop piece "${pieceLetter}"`);
    return { type: "drop", to: squareFromUsi(toStr), piece: kind };
  }
  const promote = usi.endsWith("+");
  const core = promote ? usi.slice(0, -1) : usi;
  const fromStr = core.slice(0, 2);
  const toStr = core.slice(2, 4);
  return {
    type: "move",
    from: squareFromUsi(fromStr),
    to: squareFromUsi(toStr),
    piece: "", // 呼び出し側でboard.get(from)から実際のkindを補完する
    promote,
  };
};

const squareFromUsi = (s: string): Square => {
  const file = Number(s[0]);
  const rank = s.charCodeAt(1) - "a".charCodeAt(0) + 1;
  return { row: rowFromRank(rank), col: colFromFile(file) };
};

export const squareToUsi = (sq: Square): string => {
  const file = fileFromCol(sq.col);
  const rank = rankFromRow(sq.row);
  const rankChar = String.fromCharCode("a".charCodeAt(0) + rank - 1);
  return `${file}${rankChar}`;
};
