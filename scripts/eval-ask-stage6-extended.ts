import path from "node:path";
import {
  runExtendedAskEval,
  writeExtendedAskEvalReports,
} from "../src/eval/run-extended-ask-eval";
import {
  IndexMismatchError,
  MissingApiKeyError,
  getGenerationModel,
  getOpenAiApiKey,
  loadEnv,
} from "../src/rag";

/**
 * Stage 6 extended holdout (20 questions). Review forced OFF.
 * Does not modify or overwrite the original 15-question stage4 reports.
 */
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

  console.log(
    `Stage 6 extended ask eval. model=${getGenerationModel()} review=false`,
  );

  const report = await runExtendedAskEval({
    stageLabel: "stage6-extended-holdout",
    askOptions: {
      mode: "hybrid",
      topK: 5,
      answerReviewEnabled: false,
      traceSource: "eval",
    },
  });

  const { jsonPath, mdPath } = await writeExtendedAskEvalReports(report);

  console.log(
    `done: ${report.questionCount} questions, system_errors=${report.systemErrorCount}`,
  );
  console.log(`status: ${JSON.stringify(report.statusCounts)}`);
  console.log(
    `retrieval n=${report.retrievalAverages.scoredCount} ` +
      `R@5=${report.retrievalAverages.documentRecallAt5} MRR=${report.retrievalAverages.mrr}`,
  );
  console.log(`evidence: ${JSON.stringify(report.evidenceCoverageCounts)}`);
  console.log(`setSha256: ${report.setContentSha256}`);
  console.log(`JSON: ${path.relative(ROOT, jsonPath)}`);
  console.log(`Markdown: ${path.relative(ROOT, mdPath)}`);

  for (const q of report.questions) {
    console.log(
      `${q.id} status=${q.status} cov=${q.evidenceCoverage} R@5=${q.retrievalMetrics.documentRecallAt5}`,
    );
  }
}

main().catch((error) => {
  if (error instanceof IndexMismatchError || error instanceof MissingApiKeyError) {
    console.error(error.message);
  } else {
    console.error(error instanceof Error ? error.message : error);
  }
  process.exitCode = 1;
});
