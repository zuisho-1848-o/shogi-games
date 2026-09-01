"use client";

import { pieceLabel } from "../lib/pieceLabels";

/** 将棋の駒らしい五角形の駒形+影をつけたコンポーネント。
 * 成り駒はpieceLabel側でkindに応じた文字("と"・"成銀"・"龍"等)が返るのでそのまま表示すればよい。 */
export const PieceGlyph = ({
  kind,
  promoted,
  flipped,
  size = 40,
}: {
  kind: string;
  promoted: boolean;
  /** 相手側の駒を示すために180度回転させるか */
  flipped: boolean;
  size?: number;
}) => {
  const label = pieceLabel(kind);
  // 文字数(成銀・成香等は2文字)に応じてフォントサイズを少し縮める。
  const fontSize = label.length > 1 ? size * 0.32 : size * 0.42;

  return (
    <div
      className="koma-piece"
      style={{
        width: size,
        height: size * 1.08,
        transform: flipped ? "rotate(180deg)" : undefined,
        clipPath: "polygon(50% 0%, 88% 22%, 100% 100%, 0% 100%, 12% 22%)",
        background: "linear-gradient(160deg, #f6e2b3 0%, #e8c988 55%, #dcb96f 100%)",
        boxShadow: "0 2px 3px rgba(0,0,0,0.35), inset 0 1px 1px rgba(255,255,255,0.6), inset 0 -2px 2px rgba(0,0,0,0.15)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        paddingBottom: size * 0.14,
      }}
    >
      <span
        className={["font-bold leading-none select-none", promoted ? "text-red-700" : "text-neutral-900"].join(" ")}
        style={{ fontSize, letterSpacing: label.length > 1 ? -1 : 0 }}
      >
        {label}
      </span>
    </div>
  );
};
