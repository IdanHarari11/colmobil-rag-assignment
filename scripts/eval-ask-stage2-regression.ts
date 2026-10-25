import path from "node:path";
import {
  runAskEval,
  writeAskEvalReports,
} from "../src/eval/run-ask-eval";
import {
  GenerationSystemError,
  IndexMismatchError,
  MissingApiKeyError,
  getGenerationModel,
  getOpenAiApiKey,
  loadEnv,
} from "../src/rag";

/**
 * One-shot Stage 2 regression: 15 dev questions with NO history.
 * Writes a new report file — does not overwrite prior ask-eval reports.
 */
const ROOT = process.cwd();
const DEV_SET = path.join(ROOT, "dev_set", "dev_questions.json");

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
    `Stage 2 regression: 15 dev questions WITHOUT history. model=${model}`,
  );

  const report = await runAskEval({
    devSetPath: DEV_SET,
    askOptions: { mode: "hybrid", topK: 5 },
    stageLabel: "stage2-nohistory-regression",
    includeExtraProbes: false,
  });

  const { jsonPath, mdPath } = await writeAskEvalReports(
    report,
    undefined,
    "ask-eval-stage2-nohistory",
  );

  console.log(
    `done: ${report.questionCount} questions, system_errors=${report.systemErrorCount}`,
  );
  console.log(`status counts: ${JSON.stringify(report.statusCounts)}`);
  console.log(`JSON: ${path.relative(ROOT, jsonPath)}`);
  console.log(`Markdown: ${path.relative(ROOT, mdPath)}`);
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
