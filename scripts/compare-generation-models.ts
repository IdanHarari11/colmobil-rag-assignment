import path from "node:path";
import {
  buildSharedGenerationSnapshot,
  runGenerationComparison,
  writeGenerationComparisonArtifacts,
  type ComparedModelId,
} from "../src/eval/generation-model-comparison";
import {
  GenerationSystemError,
  IndexMismatchError,
  MissingApiKeyError,
  getOpenAiApiKey,
  loadEnv,
} from "../src/rag";
import { generateGroundedAnswer } from "../src/rag/generate";

const ROOT = process.cwd();
const MODELS: ComparedModelId[] = ["gpt-4.1-mini", "gpt-5.6-terra"];
const RUNS = 3;

async function smokeStructuredOutputs(): Promise<void> {
  console.log("Smoke: structured answerParts on both models…");
  const tiny = [
    {
      chunkId: "smoke:c000",
      documentId: "smoke",
      relativePath: "smoke.md",
      text: "שעות המוקד ביום שישי: 08:00–12:00.",
      warnings: [] as string[],
      origin: "retrieved" as const,
      estimatedTokens: 20,
    },
  ];
  for (const model of MODELS) {
    const result = await generateGroundedAnswer({
      question: "מה שעות המוקד בשישי?",
      contextChunks: tiny,
      model,
    });
    console.log(
      `  OK ${model}: requested=${result.modelRequested} returned=${result.modelReturned} ` +
        `status=${result.payload.status} reasoning=${result.reasoningEffortSent ?? "n/a"} ` +
        `profile=${result.samplingProfile.kind}`,
    );
  }
}

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

  await smokeStructuredOutputs();

  const diagnosisJsonPath = path.join(
    ROOT,
    "eval_results",
    "manual-fail-diagnosis-2026-10-21T14-17-14-543Z.json",
  );

  console.log("Building shared generation snapshot…");
  const snapshot = await buildSharedGenerationSnapshot({
    diagnosisJsonPath,
    captureControlsWithModel: "gpt-4.1-mini",
  });
  console.log(`  cases=${snapshot.cases.length}`);

  console.log(
    `Running generation comparison: models=${MODELS.join(",")} runs=${RUNS}…`,
  );
  const comparison = await runGenerationComparison({
    snapshot,
    models: MODELS,
    runsPerCase: RUNS,
  });

  const { snapshotPath, jsonPath, mdPath } =
    await writeGenerationComparisonArtifacts(snapshot, comparison);

  console.log(`snapshot: ${path.relative(ROOT, snapshotPath)}`);
  console.log(`JSON: ${path.relative(ROOT, jsonPath)}`);
  console.log(`Markdown: ${path.relative(ROOT, mdPath)}`);
  console.log("");

  for (const model of MODELS) {
    const subset = comparison.rows.filter((r) => r.model === model);
    const pass = subset.filter((r) => r.passed).length;
    console.log(
      `${model}: ${pass}/${subset.length} scored passes (all cases×runs)`,
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
    console.error(error instanceof Error ? error.stack ?? error.message : error);
  }
  process.exitCode = 1;
});
