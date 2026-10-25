import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ask, type AskOptions } from "../rag/ask";
import type { AskResult } from "../rag/ask-types";
import { defaultEvalDir } from "../rag/paths";
import { retrieve } from "../rag/retrieve";
import type { RetrievalHit } from "../rag/types";
import {
  documentRecallAtK,
  mean,
  reciprocalRank,
} from "./retrieval-metrics";
import {
  loadExtendedEvalSet,
  type ExtendedEvalQuestion,
  type ExtendedEvalSet,
} from "./load-extended-set";
import type { ManualReview, ManualVerdict } from "./run-ask-eval";

export type EvidenceCoverage =
  | "full"
  | "partial"
  | "missing"
  | "n_a";

export interface ExtendedAskRow {
  id: string;
  category: string;
  tags: string[];
  question: string;
  expectedBehavior: string;
  referenceAnswer: string;
  referenceSources: string[];
  materialFacts: string[];
  forbiddenAssumptions: string[];
  evidenceChunkIds: string[];
  status: AskResult["status"] | "system_error";
  answer: string;
  answerParts: AskResult["answerParts"];
  citations: AskResult["citations"];
  citedFileNames: string[];
  requestId?: string;
  retrievedChunkIds: string[];
  contextChunkIds: string[];
  hybridTopKChunkIds: string[];
  linkedChunkIds: string[];
  retrievalMetrics: {
    documentRecallAt1: number | "N/A";
    documentRecallAt3: number | "N/A";
    documentRecallAt5: number | "N/A";
    reciprocalRank: number | "N/A";
  };
  evidenceCoverage: EvidenceCoverage;
  evidenceCoverageNote: string;
  usage?: AskResult["usage"];
  timingsMs?: AskResult["timingsMs"];
  systemError?: string;
  failureStageHint?: string;
  /** AI-assisted review vs sources — not an independent human study. */
  qualityReview: ManualReview;
}

export interface ExtendedAskEvalReport {
  generatedAt: string;
  stageLabel: string;
  configNote: string;
  setId: string;
  setPath: string;
  setContentSha256: string;
  hashMatched: boolean;
  retrievalMode: string;
  generationModel: string;
  answerReviewEnabled: false;
  questionCount: number;
  systemErrorCount: number;
  statusCounts: Record<string, number>;
  retrievalAverages: {
    scoredCount: number;
    documentRecallAt1: number | null;
    documentRecallAt3: number | null;
    documentRecallAt5: number | null;
    mrr: number | null;
  };
  evidenceCoverageCounts: Record<string, number>;
  qualityCounts: {
    conclusion: Record<string, number>;
    claimSupport: Record<string, number>;
    completeness: Record<string, number>;
    behavior: Record<string, number>;
  };
  scoringDisclaimer: string;
  questions: ExtendedAskRow[];
}

function fileBase(relativeOrName: string): string {
  return path.basename(relativeOrName);
}

function scoreRetrieval(
  q: ExtendedEvalQuestion,
  hits: RetrievalHit[],
): ExtendedAskRow["retrievalMetrics"] {
  if (q.sources.length === 0) {
    return {
      documentRecallAt1: "N/A",
      documentRecallAt3: "N/A",
      documentRecallAt5: "N/A",
      reciprocalRank: "N/A",
    };
  }
  const r1 = documentRecallAtK(hits, q.sources, 1);
  const r3 = documentRecallAtK(hits, q.sources, 3);
  const r5 = documentRecallAtK(hits, q.sources, 5);
  const rr = reciprocalRank(hits, q.sources);
  return {
    documentRecallAt1: r1 === null ? "N/A" : r1,
    documentRecallAt3: r3 === null ? "N/A" : r3,
    documentRecallAt5: r5 === null ? "N/A" : r5,
    reciprocalRank: rr === null ? "N/A" : rr,
  };
}

/**
 * Evidence coverage: required evidence chunkIds / source files present in
 * generation context (not only Hybrid top-K). N/A when no evidence required.
 */
export function assessEvidenceCoverage(
  q: ExtendedEvalQuestion,
  contextChunkIds: string[],
  contextFileNames: string[],
): { coverage: EvidenceCoverage; note: string } {
  if (q.sources.length === 0 || q.evidence.length === 0) {
    return {
      coverage: "n_a",
      note: "No required evidence sources (ambiguous / no_answer).",
    };
  }
  const ctxChunks = new Set(contextChunkIds);
  const ctxFiles = new Set(contextFileNames.map(fileBase));
  const neededChunks = q.evidence.map((e) => e.chunkId);
  const neededFiles = [...new Set(q.evidence.map((e) => fileBase(e.fileName)))];

  const chunksHit = neededChunks.filter((id) => ctxChunks.has(id));
  const filesHit = neededFiles.filter((f) => ctxFiles.has(f));

  if (chunksHit.length === neededChunks.length) {
    return {
      coverage: "full",
      note: `All ${neededChunks.length} evidence chunkId(s) in context.`,
    };
  }
  if (filesHit.length === neededFiles.length && filesHit.length > 0) {
    return {
      coverage: "partial",
      note: `All required files in context but missing some evidence chunkIds (${chunksHit.length}/${neededChunks.length}).`,
    };
  }
  if (filesHit.length > 0 || chunksHit.length > 0) {
    return {
      coverage: "partial",
      note: `Partial: files ${filesHit.length}/${neededFiles.length}, chunks ${chunksHit.length}/${neededChunks.length}.`,
    };
  }
  return {
    coverage: "missing",
    note: "No required evidence file/chunk appeared in generation context.",
  };
}

function pendingQuality(q: ExtendedEvalQuestion): ManualReview {
  return {
    conclusionCorrectness: "pending",
    claimSupport: "pending",
    essentialCompleteness: "pending",
    behaviorAppropriateness: "pending",
    focusNotes: [
      `expectedBehavior=${q.expectedBehavior}`,
      ...q.materialFacts.map((f) => `fact: ${f}`),
      ...q.forbiddenAssumptions.map((f) => `forbid: ${f}`),
    ],
    overallNotes:
      "AI-assisted scoring vs corpus evidence — not an independent human evaluation.",
  };
}

function hintFailureStage(row: {
  status: string;
  evidenceCoverage: EvidenceCoverage;
  retrievalMetrics: ExtendedAskRow["retrievalMetrics"];
  expectedBehavior: string;
}): string | undefined {
  if (row.status === "system_error") return "system";
  if (row.expectedBehavior === "insufficient_evidence") return undefined;
  if (row.expectedBehavior === "clarification_needed") return undefined;
  if (row.evidenceCoverage === "missing") {
    const r5 = row.retrievalMetrics.documentRecallAt5;
    if (r5 === 0) return "retrieval";
    return "context";
  }
  if (row.evidenceCoverage === "partial") return "context";
  return undefined;
}

export async function runExtendedAskEval(options?: {
  setPath?: string;
  askOptions?: AskOptions;
  stageLabel?: string;
}): Promise<ExtendedAskEvalReport> {
  const { set, setPath, contentSha256, hashMatched } =
    await loadExtendedEvalSet({ setPath: options?.setPath });

  const askOptions: AskOptions = {
    mode: "hybrid",
    topK: 5,
    traceSource: "eval",
    ...options?.askOptions,
    // Freeze: Stage 6 holdout always runs with semantic review off.
    answerReviewEnabled: false,
  };

  const rows: ExtendedAskRow[] = [];
  let generationModel = "";
  let systemErrorCount = 0;
  const statusCounts: Record<string, number> = {};
  const evidenceCoverageCounts: Record<string, number> = {};

  for (const q of set.questions) {
    const retrieval = await retrieve(q.question, {
      mode: askOptions.mode ?? "hybrid",
      topK: askOptions.topK ?? 5,
    });
    const retrievalMetrics = scoreRetrieval(q, retrieval.hits);

    let askResult: AskResult | undefined;
    let systemError: string | undefined;
    try {
      askResult = await ask(q.question, askOptions);
      if (askResult.generationModel) generationModel = askResult.generationModel;
    } catch (error) {
      systemError = error instanceof Error ? error.message : String(error);
      systemErrorCount += 1;
    }

    const status = askResult?.status ?? "system_error";
    statusCounts[status] = (statusCounts[status] ?? 0) + 1;

    const contextChunkIds = askResult?.contextChunks.map((c) => c.chunkId) ?? [];
    const contextFiles =
      askResult?.contextChunks.map((c) => c.relativePath) ?? [];
    const { coverage, note } = assessEvidenceCoverage(
      q,
      contextChunkIds,
      contextFiles,
    );
    evidenceCoverageCounts[coverage] =
      (evidenceCoverageCounts[coverage] ?? 0) + 1;

    const row: ExtendedAskRow = {
      id: q.id,
      category: q.category,
      tags: q.tags ?? [],
      question: q.question,
      expectedBehavior: q.expectedBehavior,
      referenceAnswer: q.reference_answer,
      referenceSources: q.sources,
      materialFacts: q.materialFacts,
      forbiddenAssumptions: q.forbiddenAssumptions,
      evidenceChunkIds: q.evidence.map((e) => e.chunkId),
      status,
      answer: askResult?.answer ?? "",
      answerParts: askResult?.answerParts ?? [],
      citations: askResult?.citations ?? [],
      citedFileNames: askResult?.sources.map((s) => s.fileName) ?? [],
      requestId: askResult?.requestId,
      retrievedChunkIds: retrieval.hits.map((h) => h.chunkId),
      contextChunkIds,
      hybridTopKChunkIds:
        askResult?.contextMeta.hybridTopKChunkIds ??
        retrieval.hits.map((h) => h.chunkId),
      linkedChunkIds: askResult?.contextMeta.linkedChunkIds ?? [],
      retrievalMetrics,
      evidenceCoverage: coverage,
      evidenceCoverageNote: note,
      usage: askResult?.usage,
      timingsMs: askResult?.timingsMs,
      systemError,
      qualityReview: pendingQuality(q),
    };
    row.failureStageHint = hintFailureStage(row);
    rows.push(row);
  }

  const scoredRetrieval = rows.filter(
    (r) => r.retrievalMetrics.documentRecallAt5 !== "N/A",
  );
  const num = (key: "documentRecallAt1" | "documentRecallAt3" | "documentRecallAt5" | "reciprocalRank") =>
    mean(
      scoredRetrieval.map((r) => r.retrievalMetrics[key] as number),
    );

  return {
    generatedAt: new Date().toISOString(),
    stageLabel: options?.stageLabel ?? "stage6-extended-holdout",
    configNote:
      "Active freeze: hybrid + Stage-4 applicability + ANSWER_REVIEW_ENABLED=false. See docs/stage6-config-freeze.md.",
    setId: set.setId,
    setPath,
    setContentSha256: contentSha256,
    hashMatched,
    retrievalMode: askOptions.mode ?? "hybrid",
    generationModel: generationModel || "(unknown)",
    answerReviewEnabled: false,
    questionCount: rows.length,
    systemErrorCount,
    statusCounts,
    retrievalAverages: {
      scoredCount: scoredRetrieval.length,
      documentRecallAt1: num("documentRecallAt1"),
      documentRecallAt3: num("documentRecallAt3"),
      documentRecallAt5: num("documentRecallAt5"),
      mrr: num("reciprocalRank"),
    },
    evidenceCoverageCounts,
    qualityCounts: emptyQualityCounts(),
    scoringDisclaimer:
      "Quality dimensions are AI-assisted judgments against corpus evidence and the frozen rubric. " +
      "They are not an independent human evaluation. The Stage-5 answer-review component is not the judge.",
    questions: rows,
  };
}

function emptyQualityCounts(): ExtendedAskEvalReport["qualityCounts"] {
  const blank = (): Record<string, number> => ({});
  return {
    conclusion: blank(),
    claimSupport: blank(),
    completeness: blank(),
    behavior: blank(),
  };
}

export function tallyQuality(
  questions: ExtendedAskRow[],
): ExtendedAskEvalReport["qualityCounts"] {
  const out = emptyQualityCounts();
  const dims: Array<{
    key: keyof ExtendedAskEvalReport["qualityCounts"];
    field: keyof ManualReview;
  }> = [
    { key: "conclusion", field: "conclusionCorrectness" },
    { key: "claimSupport", field: "claimSupport" },
    { key: "completeness", field: "essentialCompleteness" },
    { key: "behavior", field: "behaviorAppropriateness" },
  ];
  for (const q of questions) {
    for (const { key, field } of dims) {
      const v = q.qualityReview[field];
      if (typeof v !== "string") continue;
      out[key][v] = (out[key][v] ?? 0) + 1;
    }
  }
  return out;
}

export async function writeExtendedAskEvalReports(
  report: ExtendedAskEvalReport,
  basename = "ask-eval-stage6-extended",
): Promise<{ jsonPath: string; mdPath: string }> {
  const outDir = defaultEvalDir();
  await mkdir(outDir, { recursive: true });
  const jsonPath = path.join(outDir, `${basename}.json`);
  const mdPath = path.join(outDir, `${basename}.md`);
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(mdPath, formatExtendedMarkdown(report), "utf8");
  return { jsonPath, mdPath };
}

function formatExtendedMarkdown(report: ExtendedAskEvalReport): string {
  const lines = [
    `# Ask eval — Stage 6 extended holdout`,
    ``,
    `generatedAt: ${report.generatedAt}`,
    `setId: ${report.setId}`,
    `setSha256: ${report.setContentSha256} (matched=${report.hashMatched})`,
    `model: ${report.generationModel}; mode: ${report.retrievalMode}; review: false`,
    ``,
    report.configNote,
    ``,
    report.scoringDisclaimer,
    ``,
    `## Aggregates`,
    ``,
    `- status: ${JSON.stringify(report.statusCounts)}`,
    `- system_errors: ${report.systemErrorCount}`,
    `- retrieval averages (n=${report.retrievalAverages.scoredCount}, N/A excluded): ` +
      `R@1=${report.retrievalAverages.documentRecallAt1} ` +
      `R@3=${report.retrievalAverages.documentRecallAt3} ` +
      `R@5=${report.retrievalAverages.documentRecallAt5} ` +
      `MRR=${report.retrievalAverages.mrr}`,
    `- evidence coverage: ${JSON.stringify(report.evidenceCoverageCounts)}`,
    `- quality: ${JSON.stringify(report.qualityCounts)}`,
    ``,
  ];
  for (const q of report.questions) {
    lines.push(`## ${q.id} (${q.category})`);
    lines.push(`- question: ${q.question}`);
    lines.push(`- expected: ${q.expectedBehavior}`);
    lines.push(`- status: ${q.status}`);
    lines.push(`- requestId: ${q.requestId ?? "(none)"}`);
    lines.push(
      `- retrieval: R@5=${q.retrievalMetrics.documentRecallAt5} RR=${q.retrievalMetrics.reciprocalRank}`,
    );
    lines.push(
      `- evidenceCoverage: ${q.evidenceCoverage} — ${q.evidenceCoverageNote}`,
    );
    lines.push(
      `- quality: conclusion=${q.qualityReview.conclusionCorrectness} ` +
        `support=${q.qualityReview.claimSupport} ` +
        `complete=${q.qualityReview.essentialCompleteness} ` +
        `behavior=${q.qualityReview.behaviorAppropriateness}`,
    );
    lines.push(`- cited: ${q.citedFileNames.join(", ") || "(none)"}`);
    lines.push(`- answer: ${(q.answer || q.systemError || "").replace(/\n/g, " ")}`);
    lines.push(
      `- timingsMs: ${JSON.stringify(q.timingsMs ?? {})}; usage: ${JSON.stringify(q.usage ?? {})}`,
    );
    if (q.failureStageHint) {
      lines.push(`- failureStageHint: ${q.failureStageHint}`);
    }
    if (q.qualityReview.overallNotes) {
      lines.push(`- reviewNotes: ${q.qualityReview.overallNotes}`);
    }
    lines.push(``);
  }
  return lines.join("\n");
}

export type { ExtendedEvalSet, ManualVerdict };
