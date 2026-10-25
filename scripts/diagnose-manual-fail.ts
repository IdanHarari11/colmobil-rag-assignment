import path from "node:path";
import {
  runManualFailDiagnosis,
  writeManualFailDiagnosisReport,
} from "../src/eval/run-manual-fail-diagnosis";
import {
  GenerationSystemError,
  IndexMismatchError,
  MissingApiKeyError,
  getGenerationModel,
  getOpenAiApiKey,
  isAnswerReviewEnabled,
  loadEnv,
  DEFAULT_CONTEXT_BUDGET_TOKENS,
} from "../src/rag";
import { resolvePromptBundleId } from "../src/rag/trace/code-version";

const ROOT = process.cwd();

async function main(): Promise<void> {
  loadEnv(ROOT);

  try {
    getOpenAiApiKey({ required: true });
  } catch (error) {
    if (error instanceof MissingApiKeyError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const model = getGenerationModel();
  console.log(
    [
      "Manual-fail diagnosis (synthetic fixtures only).",
      `model=${model}`,
      `answerReview=${isAnswerReviewEnabled()}`,
      `promptBundleId=${resolvePromptBundleId()}`,
      `contextBudget=${DEFAULT_CONTEXT_BUDGET_TOKENS}`,
    ].join(" "),
  );

  const report = await runManualFailDiagnosis({
    askOptions: {
      mode: "hybrid",
      topK: 5,
      generationModel: model,
      answerReviewEnabled: false,
    },
  });
  report.config.generationModel = model;

  const { jsonPath, mdPath } = await writeManualFailDiagnosisReport(report);
  console.log(`turns=${report.turns.length}`);
  console.log(`JSON: ${path.relative(ROOT, jsonPath)}`);
  console.log(`Markdown: ${path.relative(ROOT, mdPath)}`);
  console.log("");

  for (const turn of report.turns) {
    console.log(
      `${turn.caseId}#${turn.turnIndex} status=${turn.status} layer~=${turn.suggestedLayer} | ` +
        `${turn.standaloneQuestion.slice(0, 70) || turn.systemError || "(no standalone)"}`,
    );
  }
}

main().catch((error) => {
  if (
    error instanceof IndexMismatchError ||
    error instanceof MissingApiKeyError ||
    error instanceof GenerationSystemError
  ) {
    console.error(error.message);
  } else {
    console.error(error instanceof Error ? error.message : error);
  }
  process.exitCode = 1;
});
