import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ask,
  assembleAnswerFromParts,
  getGenerationModel,
  getOpenAiApiKey,
  loadEnv,
  MissingApiKeyError,
  runAnswerReviewPipeline,
  AnswerReviewFailedError,
  AnswerReviewSystemError,
  type AskResult,
  type ModelGenerationPayload,
} from "../src/rag";
import { loadDevQuestions } from "../src/eval/run-retrieval-eval";
import { defaultEvalDir } from "../src/rag/paths";

/**
 * Paired Stage 5 comparison: same draft + context on both sides.
 * 1) ask(review=false) → baseline draft
 * 2) runAnswerReviewPipeline on that draft/context → review effect only
 *
 * Does not overwrite Stage 4 or stage5-review full-path reports.
 */

const ROOT = process.cwd();
const DEV_SET = path.join(ROOT, "dev_set", "dev_questions.json");

interface PairedRow {
  id: string;
  question: string;
  baselineStatus: string;
  baselineAnswer: string;
  baselineSources: string[];
  reviewOutcome: string;
  revised: boolean;
  /** AnswerStatus or review error marker. */
  finalStatus: string;
  finalAnswer: string;
  finalSources: string[];
  problemTypes: string[];
  materialFindingCount: number;
  reviewMs: number;
  revisionMs?: number;
  reviewTotalTokens?: number;
  revisionTotalTokens?: number;
  answerChanged: boolean;
  statusChanged: boolean;
  errorCode?: string;
}

function draftFromAsk(result: AskResult): ModelGenerationPayload {
  return {
    status: result.status,
    answerParts: result.answerParts,
  };
}

async function main(): Promise<void> {
  loadEnv(ROOT);
  getOpenAiApiKey({ required: true });
  const model = getGenerationModel();
  const questions = await loadDevQuestions(DEV_SET);
  const rows: PairedRow[] = [];

  console.log(`Stage 5 paired review eval. model=${model} n=${questions.length}`);

  for (const q of questions) {
    const baseline = await ask(q.question, {
      mode: "hybrid",
      topK: 5,
      answerReviewEnabled: false,
      traceSource: "eval",
    });

    const draft = draftFromAsk(baseline);
    let finalStatus: string = baseline.status;
    let finalAnswer = baseline.answer;
    let finalSources = baseline.sources.map((s) => s.fileName);
    let reviewOutcome = "skipped";
    let revised = false;
    let problemTypes: string[] = [];
    let materialFindingCount = 0;
    let reviewMs = 0;
    let revisionMs: number | undefined;
    let reviewTotalTokens: number | undefined;
    let revisionTotalTokens: number | undefined;
    let errorCode: string | undefined;

    try {
      const reviewed = await runAnswerReviewPipeline(
        {
          question: baseline.question,
          standaloneQuestion: baseline.standaloneQuestion,
          unresolvedReferences: baseline.unresolvedReferences,
          history: [],
          draft,
          contextChunks: baseline.contextChunks,
          applicabilitySummary: baseline.contextMeta.applicability,
        },
        { enabled: true, model },
      );
      const assembled = assembleAnswerFromParts(
        reviewed.payload,
        baseline.contextChunks,
      );
      finalStatus = assembled.status;
      finalAnswer = assembled.answer;
      finalSources = assembled.sources.map((s) => s.fileName);
      reviewOutcome = reviewed.meta.outcome;
      revised = reviewed.meta.revised;
      problemTypes = reviewed.meta.problemTypes;
      materialFindingCount = reviewed.meta.materialFindingCount;
      reviewMs = reviewed.meta.reviewMs.reduce((a, b) => a + b, 0);
      revisionMs = reviewed.meta.revisionMs;
      reviewTotalTokens = reviewed.meta.usage?.reviewTotalTokens;
      revisionTotalTokens = reviewed.meta.usage?.revisionTotalTokens;
    } catch (error) {
      if (error instanceof AnswerReviewFailedError) {
        errorCode = error.code;
        reviewOutcome = error.meta.outcome;
        revised = error.meta.revised;
        problemTypes = error.meta.problemTypes;
        materialFindingCount = error.meta.materialFindingCount;
        reviewMs = error.meta.reviewMs.reduce((a, b) => a + b, 0);
        revisionMs = error.meta.revisionMs;
        reviewTotalTokens = error.meta.usage?.reviewTotalTokens;
        revisionTotalTokens = error.meta.usage?.revisionTotalTokens;
        finalStatus = "answer_review_failed";
        finalAnswer = "";
        finalSources = [];
      } else if (error instanceof AnswerReviewSystemError) {
        errorCode = error.code;
        finalStatus = "answer_review_error";
        finalAnswer = "";
        finalSources = [];
      } else {
        throw error;
      }
    }

    rows.push({
      id: q.id,
      question: q.question,
      baselineStatus: baseline.status,
      baselineAnswer: baseline.answer,
      baselineSources: baseline.sources.map((s) => s.fileName),
      reviewOutcome,
      revised,
      finalStatus,
      finalAnswer,
      finalSources,
      problemTypes,
      materialFindingCount,
      reviewMs,
      revisionMs,
      reviewTotalTokens,
      revisionTotalTokens,
      answerChanged: baseline.answer !== finalAnswer,
      statusChanged: baseline.status !== finalStatus,
      errorCode,
    });

    console.log(
      `${q.id} base=${baseline.status} → ${finalStatus} outcome=${reviewOutcome} revised=${revised} Δans=${baseline.answer !== finalAnswer}`,
    );
  }

  const report = {
    generatedAt: new Date().toISOString(),
    stageLabel: "stage5-paired-review",
    model,
    note: [
      "Same draft+context for baseline vs review. Reviewer verdict is not proof it was correct;",
      "compare answers to sources independently. Stage 4 reports left untouched.",
    ].join(" "),
    questionCount: rows.length,
    revisedCount: rows.filter((r) => r.revised).length,
    answerChangedCount: rows.filter((r) => r.answerChanged).length,
    statusChangedCount: rows.filter((r) => r.statusChanged).length,
    reviewFailedCount: rows.filter((r) => r.errorCode === "answer_review_failed")
      .length,
    avgReviewMs:
      rows.reduce((s, r) => s + r.reviewMs, 0) / Math.max(rows.length, 1),
    avgReviewTokens:
      rows.reduce((s, r) => s + (r.reviewTotalTokens ?? 0), 0) /
      Math.max(rows.length, 1),
    rows,
  };

  const outDir = defaultEvalDir();
  await mkdir(outDir, { recursive: true });
  const jsonPath = path.join(outDir, "ask-eval-stage5-paired.json");
  const mdPath = path.join(outDir, "ask-eval-stage5-paired.md");
  await writeFile(jsonPath, JSON.stringify(report, null, 2), "utf8");

  const md = [
    "# Ask eval — Stage 5 paired (same draft + context)",
    "",
    `Generated: ${report.generatedAt}`,
    `Model: ${model}`,
    "",
    report.note,
    "",
    `Questions: ${report.questionCount}; revised: ${report.revisedCount}; answer changed: ${report.answerChangedCount}; status changed: ${report.statusChangedCount}; review_failed: ${report.reviewFailedCount}`,
    `Avg review ms: ${report.avgReviewMs.toFixed(0)}; avg review tokens: ${report.avgReviewTokens.toFixed(0)}`,
    "",
    "| id | baseline | final | outcome | revised | Δ |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows.map(
      (r) =>
        `| ${r.id} | ${r.baselineStatus} | ${r.finalStatus} | ${r.reviewOutcome} | ${r.revised} | ${r.answerChanged || r.statusChanged ? "yes" : "no"} |`,
    ),
    "",
    "## Per-question answers (truncated)",
    "",
    ...rows.flatMap((r) => [
      `### ${r.id}`,
      `- Baseline (${r.baselineStatus}): ${r.baselineAnswer.slice(0, 240).replace(/\n/g, " ")}`,
      `- Final (${r.finalStatus}): ${r.finalAnswer.slice(0, 240).replace(/\n/g, " ") || "(empty/error)"}`,
      `- Problems: ${r.problemTypes.join(", ") || "none"}; material=${r.materialFindingCount}`,
      "",
    ]),
  ].join("\n");
  await writeFile(mdPath, md, "utf8");

  console.log(`JSON: ${path.relative(ROOT, jsonPath)}`);
  console.log(`Markdown: ${path.relative(ROOT, mdPath)}`);
}

main().catch((error) => {
  if (error instanceof MissingApiKeyError) {
    console.error(error.message);
  } else {
    console.error(error instanceof Error ? error.message : error);
  }
  process.exitCode = 1;
});
