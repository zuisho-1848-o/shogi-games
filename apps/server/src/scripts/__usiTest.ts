import { getRuleSetById, GameState } from "@shogi-games/rule-engine";
import { chooseMoveForProfile } from "../ai/chooseMoveForProfile";
import { AiProfile } from "../aiProfiles";

const profile: AiProfile = {
  slug: "test_yaneuraou",
  name: "test",
  maxDepth: 0,
  timeBudgetMs: 1000,
  engineType: "usi",
  usiEnginePath: "/Users/zuisho/Documents/other-codes/shogi-games/vendor/bin/yaneuraou-material",
};

const main = async () => {
  const ruleSet = getRuleSetById("standard");
  const state = new GameState(ruleSet);
  const move = await chooseMoveForProfile(state.board, state.hands, state.turn, ruleSet, profile);
  console.log("chosen move:", move);
  process.exit(0);
};
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
