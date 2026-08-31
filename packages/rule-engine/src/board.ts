import { Piece, PlacementEntry, Player, RuleSet, Square, opponentOf } from "./types";

export class Board {
  readonly width: number;
  readonly height: number;
  private cells: (Piece | null)[][];

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.cells = Array.from({ length: height }, () => Array<Piece | null>(width).fill(null));
  }

  static fromRuleSet(ruleSet: RuleSet): Board {
    const board = new Board(ruleSet.boardWidth, ruleSet.boardHeight);
    board.applyPlacement(ruleSet.initialSetup.sente.pieces, "sente");
    board.applyPlacement(ruleSet.initialSetup.gote.pieces, "gote");
    return board;
  }

  private applyPlacement(entries: PlacementEntry[], owner: Player) {
    for (const entry of entries) {
      this.set(entry.square, { kind: entry.kind, owner, promoted: entry.promoted ?? false });
    }
  }

  inBounds(sq: Square): boolean {
    return sq.row >= 0 && sq.row < this.height && sq.col >= 0 && sq.col < this.width;
  }

  get(sq: Square): Piece | null {
    return this.cells[sq.row][sq.col];
  }

  set(sq: Square, piece: Piece | null) {
    this.cells[sq.row][sq.col] = piece;
  }

  clone(): Board {
    const b = new Board(this.width, this.height);
    b.cells = this.cells.map((row) => row.map((cell) => (cell ? { ...cell } : null)));
    return b;
  }

  /** 王(または獅子王バリアントの獅子など、isRoyal指定の駒)の位置を探す。royalKindsを省略すると"king"のみを対象にする。 */
  findKing(owner: Player, royalKinds: Set<string> = new Set(["king"])): Square | null {
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        const piece = this.cells[row][col];
        if (piece && piece.owner === owner && royalKinds.has(piece.kind)) {
          return { row, col };
        }
      }
    }
    return null;
  }

  allPieces(): { square: Square; piece: Piece }[] {
    const result: { square: Square; piece: Piece }[] = [];
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        const piece = this.cells[row][col];
        if (piece) result.push({ square: { row, col }, piece });
      }
    }
    return result;
  }

  piecesOf(owner: Player): { square: Square; piece: Piece }[] {
    return this.allPieces().filter((p) => p.piece.owner === owner);
  }
}

/** 先手基準の相対方向(dr,dc)を実際の盤面方向に変換する。後手は前進方向が逆(+row)になる。 */
export const toBoardDirection = (owner: Player, dr: number, dc: number): { dr: number; dc: number } =>
  owner === "sente" ? { dr, dc } : { dr: -dr, dc: -dc };

export const opponent = opponentOf;
