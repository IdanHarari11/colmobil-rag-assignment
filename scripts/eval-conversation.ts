import path from "node:path";
import {
  runConversationEval,
  writeConversationEvalReport,
} from "../src/eval/run-conversation-eval";
import {
  GenerationSystemError,
  IndexMismatchError,
  MissingApiKeyError,
  getGenerationModel,
  getOpenAiApiKey,
  loadEnv,
} from "../src/rag";

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
    `Running Stage 2 conversation fixtures (rewrite + ask). model=${getGenerationModel()}`,
  );

  const report = await runConversationEval({
    askOptions: { mode: "hybrid", topK: 5 },
  });
  const { jsonPath, mdPath } = await writeConversationEvalReport(report);

  console.log(
    `done: turns=${report.turnCount} system_errors=${report.systemErrorCount} ` +
      `standalone_failures=${report.standaloneCheckFailures}`,
  );
  console.log(
    `rewrite totals: ${report.totalRewriteMs.toFixed(0)}ms ` +
      `prompt=${report.totalRewritePromptTokens} completion=${report.totalRewriteCompletionTokens}`,
  );
  console.log(`JSON: ${path.relative(ROOT, jsonPath)}`);
  console.log(`Markdown: ${path.relative(ROOT, mdPath)}`);
  console.log("");

  for (const turn of report.turns) {
    const ok =
      turn.standaloneChecks.mustIncludeOk &&
      turn.standaloneChecks.mustNotIncludeOk &&
      turn.status !== "system_error";
    console.log(
      `${ok ? "OK" : "!!"} ${turn.fixtureId} status=${turn.status} | ` +
        `standalone=${turn.standaloneQuestion.slice(0, 80)}…`,
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
