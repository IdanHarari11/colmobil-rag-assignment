import path from "node:path";
import {
  runRetrievalEval,
  writeRetrievalEvalReports,
} from "../src/eval/run-retrieval-eval";
import {
  IndexMismatchError,
  MissingApiKeyError,
  getOpenAiApiKey,
  loadEnv,
} from "../src/rag";

const ROOT = process.cwd();
const DEV_SET = path.join(ROOT, "dev_set", "dev_questions.json");

async function main(): Promise<void> {
  loadEnv(ROOT);

  try {
    getOpenAiApiKey({ required: true });
  } catch (error) {
    if (error instanceof MissingApiKeyError) {
      console.error(error.message);
      console.error(
        "eval:retrieval calls the real embedding API for each question. It is blocked without OPENAI_API_KEY.",
      );
      console.error(
        "Local metric/unit tests do not require a key and are not a substitute for this run.",
      );
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  console.log(
    "Running retrieval eval on dev_set (mode=vector by default — not hybrid)...",
  );
  const report = await runRetrievalEval({
    devSetPath: DEV_SET,
    topK: 5,
    mode: "vector",
  });
  const { jsonPath, mdPath } = await writeRetrievalEvalReports(report);

  console.log(
    `mode=${report.mode} scored=${report.scoredQuestionCount}/${report.questionCount} (N/A refs: ${report.noReferenceQuestionIds.join(", ") || "none"})`,
  );
  console.log(
    `avg R@1=${report.averages.documentRecallAt1?.toFixed(3) ?? "N/A"} ` +
      `R@3=${report.averages.documentRecallAt3?.toFixed(3) ?? "N/A"} ` +
      `R@5=${report.averages.documentRecallAt5?.toFixed(3) ?? "N/A"} ` +
      `MRR=${report.averages.mrr?.toFixed(3) ?? "N/A"}`,
  );
  if (report.totalUsage) {
    console.log(
      `API usage: prompt_tokens=${report.totalUsage.promptTokens} total_tokens=${report.totalUsage.totalTokens}`,
    );
  }
  console.log(`JSON: ${path.relative(ROOT, jsonPath)}`);
  console.log(`Markdown: ${path.relative(ROOT, mdPath)}`);
  console.log("");
  console.log(report.disclaimer);
  console.log("");
  // Short per-question table for the terminal.
  for (const q of report.questions) {
    const topDoc = q.topHits[0]
      ? path.basename(q.topHits[0].relativePath)
      : "-";
    console.log(
      `${q.id} R@1=${q.metrics.documentRecallAt1} R@5=${q.metrics.documentRecallAt5} RR=${q.metrics.reciprocalRank} top=${topDoc}`,
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
