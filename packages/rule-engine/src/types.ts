export type Player = "sente" | "gote";

export const opponentOf = (p: Player): Player => (p === "sente" ? "gote" : "sente");

/** 行(row)は0=盤面上端, 列(col)は0=盤面右端(将棋の9筋)という内部表現に統一する。 */
export interface Square {
  row: number;
  col: number;
}

export const squareKey = (sq: Square): string => `${sq.row},${sq.col}`;

export type PieceKind = string; // "pawn" | "lance" | "knight" | ... 拡張バリアント用に文字列にしておく

export interface Piece {
  kind: PieceKind;
  owner: Player;
  promoted: boolean;
}

/** 方向ベクトル。dr,dcは先手(盤面下側・前進が-row方向)を基準にした相対値。 */
export interface MoveVector {
  dr: number;
  dc: number;
  /** 1マスのみなら1、香車や飛車のように利きが通る限り進めるならInfinity */
  range: number;
  /** 桂馬のように途中の駒を飛び越えられる場合true(range=1のジャンプ専用) */
  jump?: boolean;
}

export interface PieceDefinition {
  kind: PieceKind;
  displayName: { sente: string; gote: string };
  moves: MoveVector[];
  /** 成った時の駒kind。成れない駒(金・王など)はundefined */
  promotesTo?: PieceKind;
  /** 相手陣に入る/相手陣から出る際に成れるか。falseなら成れない駒 */
  canPromote: boolean;
  /** 手駒として打てない駒(王など)はfalseにする */
  droppable: boolean;
  /** 1ターンに複数回移動できる特殊駒(獅子など)用の拡張フラグ */
  specialMove?: "lion-double-step";
  /** trueなら王将と同じく「取られたら負け」の対象になる(獅子王バリアント用)。指定なしはkind==="king"のみ王として扱う。 */
  isRoyal?: boolean;
}

export interface PlacementEntry {
  kind: PieceKind;
  square: Square;
  promoted?: boolean;
}

export interface PlacementRule {
  /** 未指定ならそのプレイヤーは標準初期配置を使う */
  pieces: PlacementEntry[];
}

export interface CaptureRuleConfig {
  /** 取る一手将棋: 取れる手がある場合は必ず取らなければならない */
  mandatoryCapture: boolean;
  /** mandatoryCapture時、その手が自玉を王手に晒す(=王手放置になる)場合は強制から除外する */
  ignoreIfLeavesKingInCheck: boolean;
}

export type DropRuleMode = "standard" | "none" | "custom";

export interface DrawRuleConfig {
  /** 千日手(同一局面4回)で引き分けとするか */
  sennichite: boolean;
  /** 持将棋(27点法)を有効にするか */
  jishogi27: boolean;
}

export interface RuleSet {
  id: string;
  name: string;
  boardWidth: number;
  boardHeight: number;
  pieceSet: PieceDefinition[];
  initialSetup: {
    sente: PlacementRule;
    gote: PlacementRule;
  };
  captureRule: CaptureRuleConfig;
  dropRule: DropRuleMode;
  drawConditions: DrawRuleConfig;
  /** 対局開始時点で持ち駒を持たせたい場合に指定する(将棋vs囲碁の碁石など)。未指定なら通常通り持ち駒なしで始まる。 */
  initialHands?: Partial<Record<Player, Record<PieceKind, number>>>;
  /** "forced"なら成れる場面では必ず成る(不成の選択肢を出さない)。未指定は"optional"(通常通り選べる)。 */
  promotionRule?: "optional" | "forced";
}

export interface Move {
  type: "move" | "drop";
  from?: Square; // typeがmoveの場合のみ
  to: Square;
  piece: PieceKind;
  promote?: boolean;
}
