import { STANDARD_PIECE_SET } from "../pieceDefinitions";
import { RuleSet } from "../types";
import { STANDARD_RULE_SET } from "./standard";

/**
 * 将棋vs囲碁(実験的バリアント): 先手は通常の将棋一式、後手は王のみを盤上に置き、
 * 大量の石(囲碁の碁石をイメージした、移動できず打つだけの駒)を持ち駒として持つ。
 * 後手は王を動かして逃げるか、石を打って壁を作って先手の攻めを防ぐ、という非対称な対局になる。
 * 本物の囲碁のルール(陣地・アタリ・コウ等)は実装しておらず、あくまで将棋の駒移動エンジンの上で
 * 「動かせない駒を大量に打てる」という囲碁っぽさを表現した派生ルールという位置づけ。
 */
export const SHOGI_VS_GO_RULE_SET: RuleSet = {
  id: "shogi_vs_go",
  name: "将棋vs囲碁(実験的)",
  boardWidth: 9,
  boardHeight: 9,
  pieceSet: STANDARD_PIECE_SET,
  initialSetup: {
    sente: STANDARD_RULE_SET.initialSetup.sente,
    gote: { pieces: [{ kind: "king", square: { row: 0, col: 4 } }] },
  },
  captureRule: {
    mandatoryCapture: false,
    ignoreIfLeavesKingInCheck: true,
  },
  dropRule: "standard",
  drawConditions: {
    sennichite: true,
    jishogi27: false,
  },
  initialHands: {
    gote: { stone: 40 },
  },
};
