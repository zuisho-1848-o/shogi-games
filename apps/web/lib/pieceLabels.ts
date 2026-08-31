import { STANDARD_PIECE_SET } from "@shogi-games/rule-engine";

const labelMap = new Map(STANDARD_PIECE_SET.map((p) => [p.kind, p.displayName.sente]));

export const pieceLabel = (kind: string): string => labelMap.get(kind) ?? kind;
