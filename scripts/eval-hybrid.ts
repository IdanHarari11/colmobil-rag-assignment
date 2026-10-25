import path from "node:path";
import {
  runHybridComparison,
  writeHybridComparisonReports,
} from "../src/eval/run-hybrid-comparison";
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
      console.error("eval:hybrid requires OPENAI_API_KEY for one embed per question.");
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  console.log(
    "Hybrid comparison: vector vs BM25 vs RRF (one question embedding shared by vector+hybrid)...",
  );
  console.log("Baseline reports under eval_results/retrieval-eval.* are left untouched.");

  const report = await runHybridComparison({
    devSetPath: DEV_SET,
    topK: 5,
  });
  const { jsonPath, mdPath } = await writeHybridComparisonReports(report);

  console.log(`experiment=${report.experimentId}`);
  console.log(
    `index chunks=${report.index.chunkCount} model=${report.index.model} dims=${report.index.dimensions}`,
  );
  for (const mode of ["vector", "lexical", "hybrid"] as const) {
    const a = report.averages[mode];
    console.log(
      `${mode}: R@1=${a.documentRecallAt1?.toFixed(3)} R@3=${a.documentRecallAt3?.toFixed(3)} R@5=${a.documentRecallAt5?.toFixed(3)} MRR=${a.mrr?.toFixed(3)} searchMs≈${a.avgLocalSearchMs.toFixed(2)}`,
    );
  }
  console.log(
    `hybrid vs vector R@5: +${report.deltasVsVector.recallAt5.improved} / -${report.deltasVsVector.recallAt5.regressed} / =${report.deltasVsVector.recallAt5.unchanged}`,
  );
  console.log(
    `tokens: prompt=${report.totals.promptTokens} total=${report.totals.totalTokens}; avg embed=${report.totals.avgQuestionEmbeddingMs.toFixed(1)}ms`,
  );
  console.log(`JSON: ${path.relative(ROOT, jsonPath)}`);
  console.log(`Markdown: ${path.relative(ROOT, mdPath)}`);
  console.log("");
  console.log(report.disclaimer);
  console.log("");

  for (const q of report.questions) {
    const v = q.modes.vector.metrics;
    const l = q.modes.lexical.metrics;
    const h = q.modes.hybrid.metrics;
    console.log(
      `${q.id} R@5 v/l/h=${v.documentRecallAt5}/${l.documentRecallAt5}/${h.documentRecallAt5} ` +
        `RR v/l/h=${v.reciprocalRank}/${l.reciprocalRank}/${h.reciprocalRank} ` +
        `ΔR5=${q.modes.hybrid.vsVectorR5 ?? "n/a"} ΔRR=${q.modes.hybrid.vsVectorRR ?? "n/a"}`,
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
