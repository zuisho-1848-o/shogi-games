import { Board, Move, Player, RuleSet } from "@shogi-games/rule-engine";
import { AiProfile } from "../aiProfiles";
import { chooseMove } from "./simpleAi";
import { UsiEngine } from "./usiEngine";
import { boardToSfen, usiMoveToMove } from "./sfen";

type Hands = Record<Player, Record<string, number>>;

/** engineType:"usi"のプロファイルごとに1プロセスを使い回す(対局のたびに起動/終了しない)。
 * key = usiEnginePath。同じエンジンを複数プロファイルで使い回すケースは今のところ想定していない。 */
const usiEngines = new Map<string, UsiEngine>();

const getOrStartUsiEngine = async (profile: AiProfile): Promise<UsiEngine> => {
  if (!profile.usiEnginePath) throw new Error(`usi engine path missing for profile ${profile.slug}`);
  const existing = usiEngines.get(profile.usiEnginePath);
  if (existing) return existing;
  const engine = new UsiEngine({ enginePath: profile.usiEnginePath, options: profile.usiOptions });
  await engine.start();
  usiEngines.set(profile.usiEnginePath, engine);
  return engine;
};

/** AI Stage5/トラックB: プロファイルのengineTypeに応じて内蔵エンジン or 外部USIエンジンに指し手を選ばせる。
 * 外部エンジンは標準ルール(9x9)専用。それ以外のruleSetでusiプロファイルを使おうとした場合はエラーにする
 * (SFEN変換が標準将棋の駒構成・盤サイズを前提にしているため)。 */
export const chooseMoveForProfile = async (
  board: Board,
  hands: Hands,
  turn: Player,
  ruleSet: RuleSet,
  profile: AiProfile,
  options: { moveCountSoFar?: number } = {}
): Promise<Move | null> => {
  if (profile.engineType !== "usi") {
    return chooseMove(board, hands, turn, ruleSet, {
      maxDepth: profile.maxDepth,
      timeBudgetMs: profile.timeBudgetMs,
      moveCountSoFar: options.moveCountSoFar,
    });
  }

  if (ruleSet.id !== "standard") {
    throw new Error(
      `usi engine profile "${profile.slug}" only supports the standard ruleset (got "${ruleSet.id}")`
    );
  }

  const engine = await getOrStartUsiEngine(profile);
  const sfen = boardToSfen(board, hands, turn);
  const bestmove = await engine.goSfen(sfen, { byoyomiMs: profile.timeBudgetMs });
  if (bestmove === "resign" || bestmove === "win") return null;

  const move = usiMoveToMove(bestmove);
  if (move.type === "move" && move.from) {
    const piece = board.get(move.from);
    if (!piece) throw new Error(`usi engine returned move from empty square: ${bestmove}`);
    move.piece = piece.kind;
  }
  return move;
};
