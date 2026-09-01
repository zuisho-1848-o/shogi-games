import { Board, GameState, Move, Player, RuleSet } from "@shogi-games/rule-engine";
import { prisma } from "../db";
import { EvalWeights, evaluateStatic } from "./simpleAi";

export interface TrainingPosition {
  board: Board;
  hands: Record<Player, Record<string, number>>;
  turn: Player;
  ruleSet: RuleSet;
  /** その局面のturn側から見た最終結果。1=turn側が最終的に勝った、0=負けた、0.5=分け。 */
  outcome: number;
}

/** DBに保存済みの終局対局から、評価関数チューニング用の(局面, 結果)ペアを取り出す。
 * 開始直後(定跡的で情報量が少ない)と終局直前(詰み手順で不自然に偏る)を除いた中盤〜終盤を中心に、
 * 1局あたり数局面だけサンプリングする(全局面を使うと同じ対局内の隣接局面同士が強く相関してしまうため)。 */
export const collectTrainingPositions = async (options: {
  maxGames?: number;
  samplesPerGame?: number;
  skipOpeningPlies?: number;
  skipEndingPlies?: number;
}): Promise<TrainingPosition[]> => {
  const maxGames = options.maxGames ?? 500;
  const samplesPerGame = options.samplesPerGame ?? 4;
  const skipOpeningPlies = options.skipOpeningPlies ?? 8;
  const skipEndingPlies = options.skipEndingPlies ?? 4;

  const dbGames = await prisma.game.findMany({
    where: {
      status: "finished",
      resultStatus: { in: ["checkmate", "resigned", "foul_loss", "timeout", "draw"] },
      // 人間が絡む対局(手動テスト等でルールを破って中断したものを含みうる)は学習データから除外し、
      // AI同士の自己対局(selfPlayDaemon/バッチ生成)だけを使う。
      isSenteCpu: true,
      isGoteCpu: true,
    },
    include: { ruleSetPreset: true, moves: { orderBy: { moveNumber: "asc" } } },
    take: maxGames,
    orderBy: { createdAt: "desc" },
  });

  const positions: TrainingPosition[] = [];

  for (const dbGame of dbGames) {
    try {
      const ruleSet = dbGame.ruleSetPreset.config as unknown as RuleSet;
      const outcomeForSente = dbGame.winner === "sente" ? 1 : dbGame.winner === "gote" ? 0 : 0.5;

      const usablePlies = dbGame.moves.length - skipOpeningPlies - skipEndingPlies;
      if (usablePlies <= 0) continue;

      // サンプリングするply番号を等間隔で選ぶ。
      const samplePlies = new Set<number>();
      for (let i = 0; i < samplesPerGame; i++) {
        const ply = skipOpeningPlies + Math.floor((usablePlies * i) / samplesPerGame);
        samplePlies.add(ply);
      }

      const state = new GameState(ruleSet);
      for (let i = 0; i < dbGame.moves.length; i++) {
        if (samplePlies.has(i)) {
          const outcomeForTurn = state.turn === "sente" ? outcomeForSente : 1 - outcomeForSente;
          positions.push({
            board: state.board,
            hands: { sente: { ...state.hands.sente }, gote: { ...state.hands.gote } },
            turn: state.turn,
            ruleSet,
            outcome: outcomeForTurn,
          });
        }

        const m = dbGame.moves[i];
        const move: Move =
          m.moveType === "move"
            ? {
                type: "move",
                from: { row: m.fromRow!, col: m.fromCol! },
                to: { row: m.toRow, col: m.toCol },
                piece: m.piece,
                promote: m.promote,
              }
            : { type: "drop", to: { row: m.toRow, col: m.toCol }, piece: m.piece };
        state.applyMove(move);
      }
    } catch (e) {
      console.error(`[tuning] failed to replay game ${dbGame.id} for training data, skipping`, e);
    }
  }

  return positions;
};

const sigmoid = (score: number, scale: number): number => 1 / (1 + Math.exp(-score / scale));

/** 現在の重みで訓練局面をどれだけ言い当てられているか(平均二乗誤差)。小さいほど良い。 */
export const computeMeanSquaredError = (positions: TrainingPosition[], weights: EvalWeights, scale: number): number => {
  if (positions.length === 0) return 0;
  let sumSq = 0;
  for (const p of positions) {
    const score = evaluateStatic(p.board, p.hands, p.turn, p.ruleSet, weights);
    const predicted = sigmoid(score, scale);
    const err = p.outcome - predicted;
    sumSq += err * err;
  }
  return sumSq / positions.length;
};

const cloneWeights = (w: EvalWeights): EvalWeights => ({
  pieceValues: { ...w.pieceValues },
  mobilityWeight: w.mobilityWeight,
  kingSafetyWeight: w.kingSafetyWeight,
});

export interface TuneResult {
  weights: EvalWeights;
  errorBefore: number;
  errorAfter: number;
  iterations: number;
}

/** 座標降下法によるシンプルなTexelチューニング。各パラメータを少しだけ動かしてみて、
 * 訓練局面に対する予測誤差(MSE)が下がれば採用、下がらなければ元に戻す、を繰り返す。
 * 勾配を厳密に計算するのではなく「動かして試す」だけなので実装が単純で、局面サンプルが少なくても暴走しにくい。 */
export const tuneWeights = (
  positions: TrainingPosition[],
  initial: EvalWeights,
  options: { iterations?: number; scale?: number; step?: number } = {}
): TuneResult => {
  const iterations = options.iterations ?? 6;
  const scale = options.scale ?? 400; // 将棋ソフトの評価値のスケール感(±400点で勝率が大きく変わる)を模した値
  const initialStep = options.step ?? 0.5;

  let weights = cloneWeights(initial);
  let error = computeMeanSquaredError(positions, weights, scale);
  const errorBefore = error;

  // king/lion/stoneは意図的に固定(king/lionは0のまま、stoneは将棋vs囲碁専用でデータがほぼ無いため)。
  const tunableKinds = Object.keys(weights.pieceValues).filter((k) => k !== "king" && k !== "lion");

  for (let iter = 0; iter < iterations; iter++) {
    const step = initialStep * (1 - iter / iterations) + 0.05; // 反復が進むほど動かし幅を小さくする
    let improvedThisIteration = false;

    const tryDelta = (apply: (w: EvalWeights, delta: number) => void) => {
      for (const delta of [step, -step]) {
        const candidate = cloneWeights(weights);
        apply(candidate, delta);
        const candidateError = computeMeanSquaredError(positions, candidate, scale);
        if (candidateError < error) {
          weights = candidate;
          error = candidateError;
          improvedThisIteration = true;
          return;
        }
      }
    };

    for (const kind of tunableKinds) {
      tryDelta((w, delta) => {
        w.pieceValues[kind] = Math.max(0, w.pieceValues[kind] + delta);
      });
    }
    // 機動力・玉の安全度は、他の変則ルール(将棋vs囲碁の石の打ち場所判断など)で既に有効性を確認済みの項なので、
    // データ不足で0に潰れてしまわないよう下限(元の値の20%程度)を設けている。
    const mobilityFloor = initial.mobilityWeight * 0.2;
    const kingSafetyFloor = initial.kingSafetyWeight * 0.2;
    tryDelta((w, delta) => {
      w.mobilityWeight = Math.max(mobilityFloor, w.mobilityWeight + delta * 0.1);
    });
    tryDelta((w, delta) => {
      w.kingSafetyWeight = Math.max(kingSafetyFloor, w.kingSafetyWeight + delta * 0.1);
    });

    if (!improvedThisIteration) break;
  }

  return { weights, errorBefore, errorAfter: error, iterations };
};
