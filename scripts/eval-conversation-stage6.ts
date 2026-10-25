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

/**
 * Conversation fixtures under the Stage 6 frozen active config:
 * hybrid + applicability + answerReviewEnabled=false.
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
    `Conversation eval (Stage 6 active config, review OFF). model=${getGenerationModel()}`,
  );

  const report = await runConversationEval({
    askOptions: {
      mode: "hybrid",
      topK: 5,
      answerReviewEnabled: false,
      traceSource: "eval",
    },
  });

  const { jsonPath, mdPath } = await writeConversationEvalReport(report);
  console.log(
    `done: turns=${report.turnCount} system_errors=${report.systemErrorCount} ` +
      `standalone_failures=${report.standaloneCheckFailures}`,
  );
  console.log(`JSON: ${path.relative(ROOT, jsonPath)}`);
  console.log(`Markdown: ${path.relative(ROOT, mdPath)}`);
  for (const turn of report.turns) {
    console.log(
      `${turn.fixtureId} status=${turn.status} standalone_ok=` +
        `${turn.standaloneChecks.mustIncludeOk && turn.standaloneChecks.mustNotIncludeOk}`,
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
