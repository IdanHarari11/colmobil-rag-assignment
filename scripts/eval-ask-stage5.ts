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
 * Stage 5 ask eval WITH semantic draft review enabled.
 * Does not overwrite Stage 4 reports (ask-eval-stage4.*).
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
  console.log(`Stage 5 ask eval (semantic review ON). model=${model}`);

  const report = await runAskEval({
    devSetPath: DEV_SET,
    askOptions: {
      mode: "hybrid",
      topK: 5,
      traceSource: "eval",
      answerReviewEnabled: true,
    },
    stageLabel: "stage5-semantic-review",
    includeExtraProbes: false,
  });

  const { jsonPath, mdPath } = await writeAskEvalReports(
    report,
    undefined,
    "ask-eval-stage5-review",
  );

  console.log(
    `done: ${report.questionCount} questions, system_errors=${report.systemErrorCount}`,
  );
  console.log(`status counts: ${JSON.stringify(report.statusCounts)}`);
  console.log(`JSON: ${path.relative(ROOT, jsonPath)}`);
  console.log(`Markdown: ${path.relative(ROOT, mdPath)}`);

  for (const q of report.questions) {
    const rev = q.answerReview
      ? `${q.answerReview.outcome}/reviews=${q.answerReview.reviewAttempts}/rev=${q.answerReview.revised}`
      : "-";
    console.log(
      `${q.id} status=${q.status} review=${rev} code=${q.systemErrorCode ?? "-"}`,
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
