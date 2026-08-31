import { GameState, Move, MoveRecord, RuleSet } from "@shogi-games/rule-engine";
import { analyzePosition } from "./ai/simpleAi";

export interface PositionAnalysis {
  moveNumber: number;
  player: "sente" | "gote";
  actualMove: Move;
  recommendedMove: Move | null;
  /** 常に先手視点に正規化した評価値。プラスが大きいほど先手有利。将棋ソフトの評価値グラフと同じ見方ができる。 */
  evalScoreForSente: number;
  isBestMove: boolean;
}

const EVAL_CLAMP = 3000;
const clampEval = (score: number) => Math.round(Math.max(-EVAL_CLAMP, Math.min(EVAL_CLAMP, score)) * 100) / 100;

const movesEqual = (a: Move, b: Move): boolean =>
  a.type === b.type &&
  a.to.row === b.to.row &&
  a.to.col === b.to.col &&
  a.piece === b.piece &&
  !!a.promote === !!b.promote &&
  (a.type === "drop" || (a.from?.row === b.from?.row && a.from?.col === b.from?.col));

export interface AnalysisOptions {
  maxDepth?: number;
  timeBudgetMs?: number;
  /** 手数が多い対局で全部解析すると重いので、上限を設ける。 */
  maxPlies?: number;
}

/** 対局の指し手履歴を最初から再生しながら、各局面でAIに評価値と推奨手を出させる。
 * 棋譜の振り返り(評価値グラフ・「ここでは実はこの手が良かった」表示)に使う。
 * 履歴を1手ずつ辿ってAI探索を都度走らせるため、手数が多いと時間がかかる点に注意(maxPliesで上限を設けている)。 */
export const analyzeGameHistory = (
  ruleSet: RuleSet,
  history: MoveRecord[],
  options: AnalysisOptions = {}
): PositionAnalysis[] => {
  const maxDepth = options.maxDepth ?? 2;
  const timeBudgetMs = options.timeBudgetMs ?? 300;
  const maxPlies = options.maxPlies ?? 80;

  const state = new GameState(ruleSet);
  const results: PositionAnalysis[] = [];

  const pliesToAnalyze = Math.min(history.length, maxPlies);
  for (let i = 0; i < pliesToAnalyze; i++) {
    const record = history[i];
    const turn = state.turn;

    const analysis = analyzePosition(state.board, state.hands, turn, ruleSet, { maxDepth, timeBudgetMs });
    const evalScoreForSente = analysis ? clampEval(turn === "sente" ? analysis.score : -analysis.score) : 0;

    results.push({
      moveNumber: i + 1,
      player: turn,
      actualMove: record.move,
      recommendedMove: analysis?.move ?? null,
      evalScoreForSente,
      isBestMove: analysis ? movesEqual(analysis.move, record.move) : true,
    });

    state.applyMove(record.move);
  }

  return results;
};
