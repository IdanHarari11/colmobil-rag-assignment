import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ask, type AskDependencies, type AskOptions } from "../rag/ask";
import type { AskResult } from "../rag/ask-types";
import { GenerationSystemError } from "../rag/ask-types";
import { defaultEvalDir } from "../rag/paths";
import { loadDevQuestions, type DevQuestion } from "./run-retrieval-eval";

/**
 * Manual review rubric (NOT an automatic metric).
 * Four independent dimensions — do not collapse into one score.
 * reference_answer / sources are evaluation-only; never passed to ask().
 * chunkId validation is technical only — not claim-faithfulness.
 */
export const MANUAL_REVIEW_METHOD = [
  "After ask() returns, a human scores four separate dimensions (pass/partial/fail/n_a/pending):",
  "(1) conclusionCorrectness — is the main conclusion right for the question?",
  "(2) claimSupport — do cited/stated claims have support in the supplied context?",
  "(3) essentialCompleteness — are material eligibility/exceptions/calc bases present?",
  "(4) behaviorAppropriateness — answered vs clarification_needed vs abstention when warranted.",
  "Examples: D05 without clarification = behavior fail; D08 with material contradiction = answer fail;",
  "D04 may pass abstention behavior while failing claimSupport on an unsupported corpus-wide claim.",
  "Citation-id validation is automatic and technical only; it is not a faithfulness score.",
  "Do not average these into a single automatic metric.",
].join(" ");

export type ManualVerdict = "pass" | "partial" | "fail" | "n_a" | "pending";

export interface ManualReview {
  /** Main conclusion vs the question (and reference only as post-hoc aid). */
  conclusionCorrectness: ManualVerdict;
  /** Each material claim supported by supplied context? */
  claimSupport: ManualVerdict;
  /** Material conditions / exceptions / calc bases included? */
  essentialCompleteness: ManualVerdict;
  /** Appropriate answered / clarification / abstention behavior? */
  behaviorAppropriateness: ManualVerdict;
  focusNotes: string[];
  overallNotes: string;
}

export interface AskEvalQuestionResult {
  id: string;
  category: string;
  question: string;
  /** Present for post-hoc review only — never fed to ask(). */
  referenceAnswer: string;
  referenceSources: string[];
  /** True for probes that are not part of the reference set. */
  extraProbe?: boolean;
  status: AskResult["status"] | "system_error";
  answer: string;
  answerParts: AskResult["answerParts"];
  citations: AskResult["citations"];
  sources: AskResult["sources"];
  retrievedChunkIds: string[];
  contextChunkIds: string[];
  expandedChunkIds: string[];
  /** Stage 4 linked relationship chunks (not counted in Recall@5). */
  linkedChunkIds?: string[];
  hybridTopKChunkIds?: string[];
  applicabilitySummary?: {
    versionDecisions: Array<{
      documentFamily: string;
      status: string;
      selectedDocumentId?: string;
      reasonCode: string;
      dateKindUsed?: string;
    }>;
    unresolvedNotes: string[];
    activatedRelationshipCount: number;
  };
  contextMeta: AskResult["contextMeta"] | null;
  validation:
    | AskResult["validation"]
    | {
        structureOk: false;
        citationsOk: false;
        invalidCitationIds: string[];
        error: string;
      };
  retrievalMode?: string;
  generationModel?: string;
  usage?: AskResult["usage"];
  timingsMs?: AskResult["timingsMs"];
  /** Stage 2 diagnostics — present when history triggered rewrite. */
  originalQuestion?: string;
  standaloneQuestion?: string;
  unresolvedReferences?: string[];
  systemError?: string;
  /** Stable error code when status=system_error (e.g. answer_review_failed). */
  systemErrorCode?: string;
  /** Technical gate only — not claim faithfulness. */
  citationIdValidationOk?: boolean;
  /** Stage 5 semantic review metadata when enabled. */
  answerReview?: AskResult["answerReview"];
  manualReview: ManualReview;
}

export interface AskEvalReport {
  generatedAt: string;
  stageLabel?: string;
  retrievalMode: string;
  generationModel: string;
  questionCount: number;
  systemErrorCount: number;
  statusCounts: Record<string, number>;
  manualReviewMethod: string;
  disclaimer: string;
  questions: AskEvalQuestionResult[];
  extraProbes?: AskEvalQuestionResult[];
}

/** Extra behavior probes — NOT part of the reference / scored set. */
export const EXTRA_BEHAVIOR_PROBES: Array<{
  id: string;
  category: string;
  question: string;
  expectedBehavior: string;
}> = [
  {
    id: "X01",
    category: "extra_ambiguous",
    question: "מה גובה ההשתתפות העצמית שלי?",
    expectedBehavior:
      "clarification_needed — product/line/event unspecified; must not dump one product's amounts.",
  },
  {
    id: "X02",
    category: "extra_no_evidence",
    question: "האם אופק ביטוח מציעה ביטוח רחפנים מסחריים?",
    expectedBehavior:
      "insufficient_evidence — neutral server wording; no invent; no absence-proof citations.",
  },
];

function focusChecks(q: DevQuestion): string[] {
  switch (q.id) {
    case "D03":
      return [
        "FOCUS: Version appropriate to question despite 2024 ranking higher?",
      ];
    case "D04":
      return [
        "FOCUS: Abstention without inventing pet insurance?",
        "FOCUS: No unsupported claim about all corpus documents?",
      ];
    case "D05":
      return [
        "FOCUS: clarification_needed required — answering without clarification is a behavior fail.",
      ];
    case "D06":
      return [
        "FOCUS: Are definition+annex in context enough for no-coverage? Document omitted §12 separately.",
      ];
    case "D08":
      return [
        "FOCUS: Material contradiction (full refund vs pro-rata on same case) = answer fail.",
      ];
    case "D10":
      return [
        "FOCUS: Binding limits vs marketing; every stated event/limit supported including theft/total-loss row?",
      ];
    case "D11":
      return ["FOCUS: PIR eligibility condition present?"];
    case "D14":
      return ["FOCUS: Deductible calculation base correct (of what)?"];
    default:
      return [];
  }
}

function pendingManualReview(q: DevQuestion): ManualReview {
  return {
    conclusionCorrectness: "pending",
    claimSupport: "pending",
    essentialCompleteness: "pending",
    behaviorAppropriateness: "pending",
    focusNotes: focusChecks(q),
    overallNotes:
      "Filled by human after reading answer vs context/reference; not an automatic score.",
  };
}

function toEvalResult(
  q: DevQuestion,
  result: AskResult,
  extraProbe = false,
): AskEvalQuestionResult {
  return {
    id: q.id,
    category: q.category,
    question: q.question,
    referenceAnswer: q.reference_answer,
    referenceSources: q.sources,
    extraProbe,
    status: result.status,
    answer: result.answer,
    answerParts: result.answerParts,
    citations: result.citations,
    sources: result.sources,
    retrievedChunkIds: result.retrievedChunks.map((h) => h.chunkId),
    contextChunkIds: result.contextChunks.map((c) => c.chunkId),
    expandedChunkIds: result.contextChunks
      .filter((c) => c.origin === "expanded")
      .map((c) => c.chunkId),
    linkedChunkIds: result.contextChunks
      .filter((c) => c.origin === "linked")
      .map((c) => c.chunkId),
    hybridTopKChunkIds: result.contextMeta.hybridTopKChunkIds,
    applicabilitySummary: result.contextMeta.applicability
      ? {
          versionDecisions: result.contextMeta.applicability.versionDecisions.map(
            (d) => ({
              documentFamily: d.documentFamily,
              status: d.status,
              selectedDocumentId: d.selectedDocumentId,
              reasonCode: d.reasonCode,
              dateKindUsed: d.dateKindUsed,
            }),
          ),
          unresolvedNotes: result.contextMeta.applicability.unresolvedNotes,
          activatedRelationshipCount:
            result.contextMeta.applicability.activatedRelationships.length,
        }
      : undefined,
    contextMeta: result.contextMeta,
    validation: result.validation,
    citationIdValidationOk: result.validation.citationsOk,
    retrievalMode: result.retrievalMode,
    generationModel: result.generationModel,
    usage: result.usage,
    timingsMs: result.timingsMs,
    originalQuestion: result.question,
    standaloneQuestion: result.standaloneQuestion,
    unresolvedReferences: result.unresolvedReferences,
    answerReview: result.answerReview,
    manualReview: pendingManualReview(q),
  };
}

function toSystemErrorResult(
  q: DevQuestion,
  error: unknown,
  extraProbe = false,
): AskEvalQuestionResult {
  const message = error instanceof Error ? error.message : String(error);
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code: unknown }).code)
      : undefined;
  const reviewMeta =
    error &&
    typeof error === "object" &&
    "meta" in error &&
    (error as { meta?: AskResult["answerReview"] }).meta
      ? (error as { meta: AskResult["answerReview"] }).meta
      : undefined;
  return {
    id: q.id,
    category: q.category,
    question: q.question,
    referenceAnswer: q.reference_answer,
    referenceSources: q.sources,
    extraProbe,
    status: "system_error",
    answer: "",
    answerParts: [],
    citations: [],
    sources: [],
    retrievedChunkIds: [],
    contextChunkIds: [],
    expandedChunkIds: [],
    contextMeta: null,
    validation: {
      structureOk: false,
      citationsOk: false,
      invalidCitationIds: [],
      error: message,
    },
    citationIdValidationOk: false,
    systemError: message,
    systemErrorCode: code,
    answerReview: reviewMeta,
    manualReview: pendingManualReview(q),
  };
}

async function runOne(
  question: DevQuestion,
  askOptions: AskOptions,
  deps: AskDependencies | undefined,
  extraProbe: boolean,
): Promise<AskEvalQuestionResult> {
  try {
    const result = await ask(question.question, askOptions, deps);
    return toEvalResult(question, result, extraProbe);
  } catch (error) {
    if (!(error instanceof GenerationSystemError)) {
      // Still record as system_error row.
    }
    return toSystemErrorResult(question, error, extraProbe);
  }
}

/**
 * Runs ask() on each dev question text only.
 * reference_answer / sources are attached after the fact for human review.
 */
export async function runAskEval(options: {
  devSetPath: string;
  askOptions?: AskOptions;
  deps?: AskDependencies;
  stageLabel?: string;
  includeExtraProbes?: boolean;
}): Promise<AskEvalReport> {
  const questions = await loadDevQuestions(options.devSetPath);
  const askOptions: AskOptions = {
    mode: "hybrid",
    topK: 5,
    ...options.askOptions,
  };

  const results: AskEvalQuestionResult[] = [];
  let generationModel = "";
  let systemErrorCount = 0;
  const statusCounts: Record<string, number> = {};

  for (const question of questions) {
    const row = await runOne(question, askOptions, options.deps, false);
    if (row.generationModel) generationModel = row.generationModel;
    if (row.status === "system_error") systemErrorCount += 1;
    statusCounts[row.status] = (statusCounts[row.status] ?? 0) + 1;
    results.push(row);
  }

  const extraProbes: AskEvalQuestionResult[] = [];
  if (options.includeExtraProbes !== false) {
    for (const probe of EXTRA_BEHAVIOR_PROBES) {
      const asDev: DevQuestion = {
        id: probe.id,
        category: probe.category,
        question: probe.question,
        reference_answer: `(extra probe) expected: ${probe.expectedBehavior}`,
        sources: [],
      };
      const row = await runOne(asDev, askOptions, options.deps, true);
      row.manualReview.focusNotes = [
        `EXTRA PROBE (not in reference set): ${probe.expectedBehavior}`,
      ];
      if (row.generationModel) generationModel = row.generationModel;
      extraProbes.push(row);
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    stageLabel: options.stageLabel ?? "ask-eval",
    retrievalMode: askOptions.mode ?? "hybrid",
    generationModel: generationModel || "(unknown — all system errors)",
    questionCount: questions.length,
    systemErrorCount,
    statusCounts,
    manualReviewMethod: MANUAL_REVIEW_METHOD,
    disclaimer:
      "Manual review dimensions are human judgments, not automatic metrics. " +
      "Citation-id validation ≠ claim support. " +
      "API/parse failures are system_error, not insufficient_evidence. " +
      "Extra probes (X*) are behavior checks outside the reference set.",
    questions: results,
    extraProbes,
  };
}

export async function writeAskEvalReports(
  report: AskEvalReport,
  outDir = defaultEvalDir(),
  basename = "ask-eval",
): Promise<{ jsonPath: string; mdPath: string }> {
  await mkdir(outDir, { recursive: true });
  const jsonPath = path.join(outDir, `${basename}.json`);
  const mdPath = path.join(outDir, `${basename}.md`);
  await writeFile(jsonPath, JSON.stringify(report, null, 2), "utf8");
  await writeFile(mdPath, formatAskEvalMarkdown(report), "utf8");
  return { jsonPath, mdPath };
}

function formatOneQuestion(q: AskEvalQuestionResult): string[] {
  const lines: string[] = [
    `## ${q.id} (${q.category})${q.extraProbe ? " — EXTRA PROBE" : ""}`,
    ``,
    `**Question:** ${q.question}`,
    ``,
    `**Status:** ${q.status}`,
    ``,
    `**Answer:**`,
    ``,
    q.answer || q.systemError || "(empty)",
    ``,
    `**Answer parts:** ${q.answerParts?.length ?? 0}`,
    `**Citations (from parts):** ${q.citations.map((c) => c.chunkId).join(", ") || "(none)"}`,
    `**Retrieved:** ${q.retrievedChunkIds.join(", ") || "(none)"}`,
    `**Context (+expanded):** ${q.contextChunkIds.join(", ") || "(none)"}` +
      (q.expandedChunkIds.length
        ? ` — expanded: ${q.expandedChunkIds.join(", ")}`
        : ""),
    `**Validation (chunkId technical only):** structure=${q.validation.structureOk} citations=${q.validation.citationsOk}`,
  ];
  if (q.linkedChunkIds?.length) {
    lines.push(`**Linked (relations, not Recall@5):** ${q.linkedChunkIds.join(", ")}`);
  }
  if (q.applicabilitySummary) {
    const decisions = q.applicabilitySummary.versionDecisions
      .map(
        (d) =>
          `${d.documentFamily}:${d.status}` +
          (d.selectedDocumentId ? `→${d.selectedDocumentId}` : "") +
          `(${d.reasonCode})`,
      )
      .join("; ");
    lines.push(
      `**Applicability:** ${decisions || "(none)"}` +
        (q.applicabilitySummary.unresolvedNotes.length
          ? ` | unresolved=${q.applicabilitySummary.unresolvedNotes.join(",")}`
          : "") +
        ` | relationships=${q.applicabilitySummary.activatedRelationshipCount}`,
    );
  }
  if (q.contextMeta?.omittedExpansions?.length) {
    lines.push(
      `**Omitted expansions:** ${q.contextMeta.omittedExpansions.map((o) => o.chunkId).join(", ")}`,
    );
  }
  if (q.usage) {
    lines.push(
      `**Tokens:** embed=${q.usage.embeddingPromptTokens ?? "-"} gen_total=${q.usage.generationTotalTokens ?? "-"}`,
    );
  }
  if (q.timingsMs) {
    lines.push(
      `**Timings (ms):** retrieve=${q.timingsMs.retrieveMs.toFixed(0)} gen=${q.timingsMs.generationMs.toFixed(0)} total=${q.timingsMs.totalMs.toFixed(0)}`,
    );
  }
  if (q.manualReview.focusNotes.length) {
    lines.push(``);
    lines.push(`**Manual focus:**`);
    for (const note of q.manualReview.focusNotes) {
      lines.push(`- ${note}`);
    }
  }
  lines.push(``);
  lines.push(
    `**Manual review:** conclusion=${q.manualReview.conclusionCorrectness} ` +
      `claimSupport=${q.manualReview.claimSupport} ` +
      `completeness=${q.manualReview.essentialCompleteness} ` +
      `behavior=${q.manualReview.behaviorAppropriateness}`,
  );
  lines.push(``);
  lines.push(`<details><summary>Reference (review only)</summary>`);
  lines.push(``);
  lines.push(q.referenceAnswer);
  lines.push(``);
  lines.push(`Sources: ${q.referenceSources.join(", ") || "(none)"}`);
  lines.push(``);
  lines.push(`</details>`);
  lines.push(``);
  return lines;
}

export function formatAskEvalMarkdown(report: AskEvalReport): string {
  const lines: string[] = [
    `# Ask evaluation${report.stageLabel ? ` — ${report.stageLabel}` : ""}`,
    ``,
    `- Generated: ${report.generatedAt}`,
    `- Retrieval mode: ${report.retrievalMode}`,
    `- Generation model: ${report.generationModel}`,
    `- Questions: ${report.questionCount}`,
    `- System errors: ${report.systemErrorCount}`,
    `- Status counts: ${JSON.stringify(report.statusCounts)}`,
    ``,
    `## Method notes`,
    ``,
    report.manualReviewMethod,
    ``,
    report.disclaimer,
    ``,
  ];

  for (const q of report.questions) {
    lines.push(...formatOneQuestion(q));
  }

  if (report.extraProbes?.length) {
    lines.push(`# Extra behavior probes (not in reference set)`);
    lines.push(``);
    for (const q of report.extraProbes) {
      lines.push(...formatOneQuestion(q));
    }
  }

  return lines.join("\n");
}
