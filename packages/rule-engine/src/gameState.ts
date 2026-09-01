import { Board } from "./board";
import {
  applyMoveToBoard,
  generateLegalMoves,
  isInCheck,
  isInPromotionZone,
  royalKindsOf,
} from "./moveGenerator";
import { baseKindOf } from "./pieceDefinitions";
import { Move, Player, RuleSet, opponentOf } from "./types";

export type GameResult =
  | { status: "in_progress" }
  | { status: "checkmate"; winner: Player }
  | { status: "resigned"; winner: Player }
  | { status: "draw"; reason: "sennichite" | "jishogi" }
  | { status: "foul_loss"; winner: Player; reason: "perpetual_check" }
  | { status: "jishogi_win"; winner: Player }
  | { status: "timeout"; winner: Player };

/** 持将棋(27点法)の駒点。飛車・角(および成った馬・龍)は5点、王は0点、それ以外は1点という一般的な数え方。 */
const PIECE_POINTS: Record<string, number> = {
  king: 0,
  lion: 0,
  stone: 0,
  rook: 5,
  dragon: 5,
  bishop: 5,
  horse: 5,
};
const pointsOf = (kind: string): number => PIECE_POINTS[kind] ?? 1;

export interface MoveRecord {
  player: Player;
  move: Move;
  capturedKind?: string;
  /** この手によって相手を王手にしたか(連続王手の千日手判定に使う) */
  checkedOpponent: boolean;
}

/** 局面(盤面+持ち駒+手番)を一意に表す文字列。千日手判定に使う。 */
const positionKey = (board: Board, hands: Record<Player, Record<string, number>>, turn: Player): string => {
  let key = turn;
  for (let row = 0; row < board.height; row++) {
    for (let col = 0; col < board.width; col++) {
      const piece = board.get({ row, col });
      key += piece ? `${piece.owner[0]}${piece.kind}${piece.promoted ? "+" : ""}|` : ".";
    }
  }
  for (const player of ["sente", "gote"] as Player[]) {
    const entries = Object.entries(hands[player])
      .filter(([, count]) => count > 0)
      .sort(([a], [b]) => a.localeCompare(b));
    for (const [kind, count] of entries) key += `#${player[0]}${kind}${count}`;
  }
  return key;
};

export class GameState {
  readonly ruleSet: RuleSet;
  board: Board;
  turn: Player;
  hands: Record<Player, Record<string, number>>;
  history: MoveRecord[] = [];
  result: GameResult = { status: "in_progress" };
  private positionCounts = new Map<string, number>();
  /** history[i]を指した結果たどり着いた局面のキー。連続王手の千日手判定で直近のサイクルを特定するのに使う。 */
  private positionKeyHistory: string[] = [];

  constructor(ruleSet: RuleSet) {
    this.ruleSet = ruleSet;
    this.board = Board.fromRuleSet(ruleSet);
    this.turn = "sente";
    this.hands = {
      sente: { ...(ruleSet.initialHands?.sente ?? {}) },
      gote: { ...(ruleSet.initialHands?.gote ?? {}) },
    };
    this.positionCounts.set(positionKey(this.board, this.hands, this.turn), 1);
  }

  legalMoves(player: Player = this.turn): Move[] {
    const opponentHand = this.hands[opponentOf(player)];
    return generateLegalMoves(this.board, player, this.hands[player], this.ruleSet, opponentHand);
  }

  isInCheck(player: Player = this.turn): boolean {
    return isInCheck(this.board, player, this.ruleSet);
  }

  /** 手を適用する。合法性チェックは呼び出し側でlegalMoves()を使って行う想定。 */
  applyMove(move: Move): void {
    if (this.result.status !== "in_progress") throw new Error("game already finished");

    const owner = this.turn;
    const { board: nextBoard, captured } = applyMoveToBoard(this.board, owner, move, this.ruleSet);
    this.board = nextBoard;

    if (move.type === "drop") {
      this.hands[owner][move.piece] = (this.hands[owner][move.piece] ?? 0) - 1;
    }

    if (captured) {
      const handKind = baseKindOf(this.ruleSet.pieceSet, captured.kind);
      this.hands[owner][handKind] = (this.hands[owner][handKind] ?? 0) + 1;
    }

    const next = opponentOf(owner);
    this.turn = next;

    const checkedOpponent = isInCheck(this.board, next, this.ruleSet);
    this.history.push({ player: owner, move, capturedKind: captured?.kind, checkedOpponent });

    if (this.ruleSet.drawConditions.sennichite) {
      const key = positionKey(this.board, this.hands, this.turn);
      this.positionKeyHistory.push(key);
      const count = (this.positionCounts.get(key) ?? 0) + 1;
      this.positionCounts.set(key, count);
      if (count >= 4) {
        const violator = this.findPerpetualCheckViolator(key);
        if (violator) {
          // 連続王手の千日手: 王手をかけ続けた側の反則負け。
          this.result = { status: "foul_loss", winner: opponentOf(violator), reason: "perpetual_check" };
        } else {
          this.result = { status: "draw", reason: "sennichite" };
        }
        return;
      }
    }

    if (this.result.status === "in_progress" && this.ruleSet.drawConditions.jishogi27 && this.checkJishogi()) {
      return;
    }

    const opponentLegalMoves = this.legalMoves(next);
    if (opponentLegalMoves.length === 0) {
      // 詰み(王手をかけられた状態で応手なし)。将棋では通常王手されていない限り着手可能手が尽きることはないため、
      // 保険としてどちらの場合も手番側の負けとして扱う。
      this.result = { status: "checkmate", winner: owner };
    }
  }

  /** 直近のサイクル(この局面が前回出現してから今回出現するまでの手順)で、
   * 一方の側が指した手が全て王手だった場合、その側を返す(連続王手の反則)。該当なければnull。 */
  private findPerpetualCheckViolator(repeatedKey: string): Player | null {
    const occurrences: number[] = [];
    this.positionKeyHistory.forEach((k, i) => {
      if (k === repeatedKey) occurrences.push(i);
    });
    if (occurrences.length < 2) return null;

    const cycleStart = occurrences[occurrences.length - 2] + 1;
    const cycleEnd = occurrences[occurrences.length - 1]; // inclusive
    const cycleMoves = this.history.slice(cycleStart, cycleEnd + 1);
    if (cycleMoves.length === 0) return null;

    for (const player of ["sente", "gote"] as Player[]) {
      const playerMoves = cycleMoves.filter((m) => m.player === player);
      if (playerMoves.length > 0 && playerMoves.every((m) => m.checkedOpponent)) {
        return player;
      }
    }
    return null;
  }

  /** 持将棋(27点法)の判定。両者の玉が入玉(敵陣に到達)している場合のみ判定を行う。
   * 27点以上ある側が入玉していれば勝ち抜け、両者とも27点以上なら引き分け。どちらも届いていなければ対局続行。
   * trueを返した場合はthis.resultを更新済み。 */
  private checkJishogi(): boolean {
    const royalKinds = royalKindsOf(this.ruleSet.pieceSet);
    const senteKing = this.board.findKing("sente", royalKinds);
    const goteKing = this.board.findKing("gote", royalKinds);
    if (!senteKing || !goteKing) return false;

    const senteEntered = isInPromotionZone("sente", senteKing, this.board);
    const goteEntered = isInPromotionZone("gote", goteKing, this.board);
    if (!senteEntered || !goteEntered) return false;

    const sentePoints = this.jishogiPoints("sente");
    const gotePoints = this.jishogiPoints("gote");
    const senteQualifies = sentePoints >= 27;
    const goteQualifies = gotePoints >= 27;

    if (senteQualifies && goteQualifies) {
      this.result = { status: "draw", reason: "jishogi" };
      return true;
    }
    if (senteQualifies) {
      this.result = { status: "jishogi_win", winner: "sente" };
      return true;
    }
    if (goteQualifies) {
      this.result = { status: "jishogi_win", winner: "gote" };
      return true;
    }
    return false;
  }

  private jishogiPoints(player: Player): number {
    let total = 0;
    for (const { piece } of this.board.piecesOf(player)) total += pointsOf(piece.kind);
    for (const [kind, count] of Object.entries(this.hands[player])) total += pointsOf(kind) * count;
    return total;
  }

  resign(player: Player): void {
    this.result = { status: "resigned", winner: opponentOf(player) };
  }

  /** 持ち時間切れによる時間切れ負け。playerが時間切れになった側。 */
  timeout(player: Player): void {
    if (this.result.status !== "in_progress") return;
    this.result = { status: "timeout", winner: opponentOf(player) };
  }
}
