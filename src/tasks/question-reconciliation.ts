import { subtask } from "@constal/sdk";
import { loadArtifact, type ArtifactEnvelope } from "../artifacts.js";
import { parseHzQuestionReconciliation, type HzDecisionQuestion, type HzQuestionReconciliation } from "../contracts.js";
import { HORIZON_STANDARD_LOOP_TURNS } from "../limits.js";
import { QUESTION_RECONCILIATION_SYSTEM } from "../prompts/question-reconciliation.js";
import { runReactLoop } from "../react-loop.js";

interface QuestionReconciliationInput {
  candidate: HzDecisionQuestion;
  history: Array<{ question: HzDecisionQuestion; answer: string }>;
}

export const questionReconciler = subtask<HzQuestionReconciliation>({
  id: "horizon-question-reconciliation", version: "1",
  async run(envelope: ArtifactEnvelope, ctx) {
    const input = await loadArtifact<QuestionReconciliationInput>(ctx, envelope);
    const loop = await runReactLoop({ role: "question-reconciliation", system: QUESTION_RECONCILIATION_SYSTEM,
      objective: "Determine whether the candidate requires a new user decision.", context: input,
      tools: [], model: "model", maxRounds: HORIZON_STANDARD_LOOP_TURNS,
      parse: parseHzQuestionReconciliation }, ctx);
    return loop.artifact;
  },
});
