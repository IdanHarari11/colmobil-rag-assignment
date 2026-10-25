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
 * Stage 4 ask eval: version/applicability enrichment enabled (default ask path).
 * Writes a new report — does not overwrite stage5.3 / stage2 baselines.
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
    `Stage 4 ask eval (applicability enrichment). model=${model}`,
  );

  const report = await runAskEval({
    devSetPath: DEV_SET,
    // Freeze Stage 4 path: applicability on, semantic review off.
    askOptions: {
      mode: "hybrid",
      topK: 5,
      traceSource: "eval",
      answerReviewEnabled: false,
    },
    stageLabel: "stage4-applicability",
    includeExtraProbes: false,
  });

  const { jsonPath, mdPath } = await writeAskEvalReports(
    report,
    undefined,
    "ask-eval-stage4",
  );

  console.log(
    `done: ${report.questionCount} questions, system_errors=${report.systemErrorCount}`,
  );
  console.log(`status counts: ${JSON.stringify(report.statusCounts)}`);
  console.log(`JSON: ${path.relative(ROOT, jsonPath)}`);
  console.log(`Markdown: ${path.relative(ROOT, mdPath)}`);

  for (const q of report.questions) {
    const app = q.applicabilitySummary?.versionDecisions
      .map((d) => `${d.documentFamily}:${d.status}/${d.reasonCode}`)
      .join(",") || "-";
    console.log(
      `${q.id} status=${q.status} linked=${q.linkedChunkIds?.length ?? 0} app=${app}`,
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
