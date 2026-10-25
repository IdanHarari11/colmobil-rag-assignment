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
        "eval:ask calls embedding + generation APIs. Blocked without OPENAI_API_KEY.",
      );
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const model = getGenerationModel();
  console.log(
    `Running ask() eval on 15 questions (hybrid retrieve → generate). model=${model}`,
  );
  console.log(
    "dev_set reference answers/sources are used ONLY after ask() for manual review scaffolding.",
  );

  const report = await runAskEval({
    devSetPath: DEV_SET,
    askOptions: { mode: "hybrid", topK: 5 },
    stageLabel: "stage5.3-revert-preclarify",
    includeExtraProbes: true,
  });
  const { jsonPath, mdPath } = await writeAskEvalReports(
    report,
    undefined,
    "ask-eval-stage5.3",
  );
  // Also refresh the latest pointer copy.
  await writeAskEvalReports(report, undefined, "ask-eval");

  console.log(
    `done: ${report.questionCount} questions, system_errors=${report.systemErrorCount}`,
  );
  console.log(`status counts: ${JSON.stringify(report.statusCounts)}`);
  console.log(`JSON: ${path.relative(ROOT, jsonPath)}`);
  console.log(`Markdown: ${path.relative(ROOT, mdPath)}`);
  console.log("");
  console.log(report.disclaimer);
  console.log("");

  for (const q of report.questions) {
    const preview = (q.answer || q.systemError || "")
      .replace(/\s+/g, " ")
      .slice(0, 120);
    console.log(
      `${q.id} status=${q.status} citations=${q.citations.length} ` +
        `ctx=${q.contextChunkIds.length}(+${q.expandedChunkIds.length}) | ${preview}…`,
    );
  }

  if (report.extraProbes?.length) {
    console.log("");
    console.log("Extra probes (not in reference set):");
    for (const q of report.extraProbes) {
      const preview = (q.answer || q.systemError || "")
        .replace(/\s+/g, " ")
        .slice(0, 120);
      console.log(`${q.id} status=${q.status} | ${preview}…`);
    }
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
