import {
  getGenerationModel,
  getOpenAiApiKey,
  loadEnv,
} from "../src/rag";
import { ask } from "../src/rag/ask";
import { MANUAL_FAIL_CASES } from "../src/eval/manual-fail-regression-fixtures";

async function main(): Promise<void> {
  loadEnv(process.cwd());
  getOpenAiApiKey({ required: true });
  const id = process.argv[2] ?? "MF-E";
  const caseDef = MANUAL_FAIL_CASES.find((c) => c.id === id);
  if (!caseDef) throw new Error(`Unknown case ${id}`);
  const turnIndex = Number(process.argv[3] ?? "0");
  const turn = caseDef.turns[turnIndex];
  if (!turn) throw new Error(`Missing turn ${turnIndex}`);

  const result = await ask(
    turn.question,
    {
      mode: "hybrid",
      topK: 5,
      answerReviewEnabled: false,
      generationModel: getGenerationModel(),
      history: turn.history,
      traceSource: "eval",
    },
  );

  console.log(
    JSON.stringify(
      {
        caseId: id,
        turnIndex,
        status: result.status,
        answer: result.answer,
        standaloneQuestion: result.standaloneQuestion,
        unresolvedReferences: result.unresolvedReferences,
        retrieved: result.retrievedChunks.map((h) => h.chunkId),
        context: result.contextChunks.map((c) => c.chunkId),
        enrichmentOmissions: result.contextMeta.enrichmentOmissions,
        applicability: result.contextMeta.applicability?.promptLines,
        cited: result.sources.map((s) => ({
          chunkId: s.chunkId,
          fileName: s.fileName,
          documentTitle: s.documentTitle,
          sectionPath: s.sectionPath,
        })),
        answerParts: result.answerParts,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
