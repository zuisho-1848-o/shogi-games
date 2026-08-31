import { GameState, Move, Player } from "@shogi-games/rule-engine";
import { ServerGame } from "./gameManager";

export interface ClientPiece {
  kind: string;
  owner: Player;
  promoted: boolean;
}

export interface ClientGameState {
  gameId: string;
  boardWidth: number;
  boardHeight: number;
  board: (ClientPiece | null)[][];
  hands: Record<Player, Record<string, number>>;
  turn: Player;
  result: GameState["result"];
  legalMovesForYou: Move[];
  yourColor: Player | null;
  isInCheck: Record<Player, boolean>;
  roomCode?: string;
  bothPlayersConnected: boolean;
  /** サーバー内蔵CPU、または外部AI(ボット)が対局相手かどうか(自己申告ベース)。UIでの表示にのみ使う。 */
  opponentIsCpuOrBot: Partial<Record<Player, boolean>>;
}

export const serializeGame = (game: ServerGame, viewerColor: Player | null): ClientGameState => {
  const { state } = game;
  const board: (ClientPiece | null)[][] = [];
  for (let row = 0; row < state.board.height; row++) {
    const rowCells: (ClientPiece | null)[] = [];
    for (let col = 0; col < state.board.width; col++) {
      const piece = state.board.get({ row, col });
      rowCells.push(piece ? { kind: piece.kind, owner: piece.owner, promoted: piece.promoted } : null);
    }
    board.push(rowCells);
  }

  const legalMovesForYou =
    viewerColor && viewerColor === state.turn && state.result.status === "in_progress"
      ? state.legalMoves(viewerColor)
      : [];

  return {
    gameId: game.id,
    boardWidth: state.board.width,
    boardHeight: state.board.height,
    board,
    hands: state.hands,
    turn: state.turn,
    result: state.result,
    legalMovesForYou,
    yourColor: viewerColor,
    isInCheck: { sente: state.isInCheck("sente"), gote: state.isInCheck("gote") },
    roomCode: game.roomCode,
    bothPlayersConnected: game.mode === "cpu" ? true : Object.keys(game.tokens).length >= 2,
    opponentIsCpuOrBot: { ...game.cpuColors, ...game.declaredBots },
  };
};
