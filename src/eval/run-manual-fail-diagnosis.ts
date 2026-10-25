import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ask, type AskDependencies, type AskOptions } from "../rag/ask";
import type { AskResult } from "../rag/ask-types";
import { GenerationSystemError } from "../rag/ask-types";
import { defaultEvalDir } from "../rag/paths";
import {
  MANUAL_FAIL_CASES,
  MANUAL_FAIL_REGRESSION_SET_ID,
  type ManualFailCase,
  type ManualFailTurn,
} from "./manual-fail-regression-fixtures";

/**
 * Layer diagnosis for manual-fail cases.
 * Writes a dedicated report under eval_results/ — synthetic fixture text only.
 * Does not enable general conversation logging of real user chats.
 */

export type FailureLayer =
  | "rewrite"
  | "retrieval"
  | "context_applicability"
  | "generation"
  | "mixed"
  | "not_reproduced"
  | "undetermined";

export interface TurnDiagnosis {
  caseId: string;
  title: string;
  failureTheme: string;
  turnIndex: number;
  question: string;
  historyLength: number;
  status: AskResult["status"] | "system_error";
  answer: string;
  standaloneQuestion: string;
  unresolvedReferences: string[];
  rewriteMs?: number;
  retrievedChunkIds: string[];
  retrievedFileNames: string[];
  contextChunkIds: string[];
  contextFileNames: string[];
  contextOrigins: string[];
  applicabilityPromptLines: string[];
  enrichmentOmissions: Array<{ chunkId: string; reasonCode: string }>;
  omittedRetrieved: Array<{ chunkId: string; reason: string }>;
  answerParts: AskResult["answerParts"];
  citedChunkIds: string[];
  citedFileNames: string[];
  citedSectionPaths: Array<string[] | undefined>;
  citationNumbersUniqueInAnswer: boolean;
  sourceCardsDistinguishVersions: boolean;
  sectionPathPresent: boolean;
  standaloneChecks?: {
    mustIncludeOk: boolean;
    mustNotIncludeOk: boolean;
    missingIncludes: string[];
    leakedExcludes: string[];
  };
  observedFailure: string;
  sourceNotes: string;
  systemError?: string;
  /** Heuristic layer hint for the report author — not authoritative alone. */
  suggestedLayer: FailureLayer;
  layerEvidence: string[];
}

export interface ManualFailDiagnosisReport {
  generatedAt: string;
  setId: string;
  stageLabel: string;
  config: {
    retrievalMode: string;
    topK: number;
    generationModel: string;
    answerReviewEnabled: boolean;
  };
  turns: TurnDiagnosis[];
}

function checkStandalone(
  standalone: string,
  expect: ManualFailTurn["expectStandalone"],
): TurnDiagnosis["standaloneChecks"] | undefined {
  if (!expect) return undefined;
  const missingIncludes: string[] = [];
  const leakedExcludes: string[] = [];
  for (const needle of expect.mustInclude ?? []) {
    if (!standalone.includes(needle)) missingIncludes.push(needle);
  }
  for (const needle of expect.mustNotInclude ?? []) {
    if (standalone.includes(needle)) leakedExcludes.push(needle);
  }
  return {
    mustIncludeOk: missingIncludes.length === 0,
    mustNotIncludeOk: leakedExcludes.length === 0,
    missingIncludes,
    leakedExcludes,
  };
}

function uniqueCitationNumbers(parts: AskResult["answerParts"]): boolean {
  const ids = parts.flatMap((p) => p.sourceChunkIds);
  return new Set(ids).size === ids.length || ids.length === 0;
}

function versionsDistinguishable(fileNames: string[]): boolean {
  const car = fileNames.filter((f) =>
    /car_comprehensive_policy_20(24|26)/.test(f),
  );
  if (car.length < 2) return true;
  const has2024 = car.some((f) => f.includes("2024"));
  const has2026 = car.some((f) => f.includes("2026"));
  return !(has2024 && has2026) || (has2024 && has2026);
}

function suggestLayer(input: {
  historyLength: number;
  standaloneChecks?: TurnDiagnosis["standaloneChecks"];
  standaloneQuestion: string;
  status: AskResult["status"] | "system_error";
  answer: string;
  retrievedFileNames: string[];
  citedFileNames: string[];
  applicabilityPromptLines: string[];
  observedFailure: string;
  failureTheme: string;
}): { layer: FailureLayer; evidence: string[] } {
  const evidence: string[] = [];
  const sc = input.standaloneChecks;
  if (sc && (!sc.mustIncludeOk || !sc.mustNotIncludeOk)) {
    evidence.push(
      `rewrite standalone checks failed: missing=${sc.missingIncludes.join("|") || "—"} leaked=${sc.leakedExcludes.join("|") || "—"}`,
    );
  }

  if (
    input.failureTheme === "user_fact_correction_date" &&
    (/1\.1\.2024/.test(input.standaloneQuestion) ||
      (/2024/.test(input.standaloneQuestion) &&
        /פברואר|אפריל/.test(input.standaloneQuestion) === false))
  ) {
    evidence.push(
      "standaloneQuestion appears to mutate user issue date toward 2024/index base",
    );
  }

  if (
    input.failureTheme === "topic_switch_false_clarification" &&
    input.status === "clarification_needed"
  ) {
    evidence.push("status=clarification_needed on a concrete topic-switch ask");
  }

  if (
    input.failureTheme === "english_faq_miss_false_clarify" &&
    input.status === "clarification_needed"
  ) {
    evidence.push("clarification instead of English FAQ answer");
  }

  if (
    input.failureTheme === "english_faq_miss_false_clarify" &&
    !input.retrievedFileNames.some((f) => (f ?? "").includes("agent_faq"))
  ) {
    evidence.push("agent FAQ chunk not in retrieved set");
  }

  if (
    input.failureTheme === "partial_update_old_rule_leak" &&
    /5\s*%|5%/.test(input.answer)
  ) {
    evidence.push("answer still mentions 5% handling fee");
  }

  if (
    input.failureTheme === "amount_application_incomplete" &&
    /300/.test(input.answer) &&
    !/220/.test(input.answer)
  ) {
    evidence.push("ceiling present but 220 amount not applied in answer");
  }

  if (
    input.failureTheme === "multi_applicability_single_ask" &&
    input.applicabilityPromptLines.length === 0
  ) {
    evidence.push("no applicability prompt lines for multi-date ask");
  }

  const rewriteFail = evidence.some((e) => e.startsWith("rewrite"));
  const retrievalFail = evidence.some((e) => e.includes("not in retrieved"));
  const genFail = evidence.some(
    (e) =>
      e.includes("clarification") ||
      e.includes("5%") ||
      e.includes("220") ||
      e.includes("mutate"),
  );
  const contextFail = evidence.some((e) => e.includes("applicability"));

  if (evidence.length === 0) {
    return { layer: "undetermined", evidence: ["no automatic failure markers"] };
  }
  const kinds = [
    rewriteFail && "rewrite",
    retrievalFail && "retrieval",
    contextFail && "context_applicability",
    genFail && "generation",
  ].filter(Boolean) as FailureLayer[];
  if (kinds.length > 1) return { layer: "mixed", evidence };
  return { layer: kinds[0] ?? "undetermined", evidence };
}

function summarizeResult(
  caseDef: ManualFailCase,
  turn: ManualFailTurn,
  turnIndex: number,
  result: AskResult,
): TurnDiagnosis {
  const standaloneChecks = checkStandalone(
    result.standaloneQuestion,
    turn.expectStandalone,
  );
  const citedFileNames = result.sources.map((s) => s.fileName);
  const citedSectionPaths = result.sources.map((s) => s.sectionPath);
  const hint = suggestLayer({
    historyLength: turn.history.length,
    standaloneChecks,
    standaloneQuestion: result.standaloneQuestion,
    status: result.status,
    answer: result.answer,
    retrievedFileNames: result.retrievedChunks.map((h) => h.relativePath || h.documentId || h.chunkId),
    citedFileNames,
    applicabilityPromptLines:
      result.contextMeta.applicability?.promptLines ?? [],
    observedFailure: turn.observedFailure,
    failureTheme: caseDef.failureTheme,
  });

  return {
    caseId: caseDef.id,
    title: caseDef.title,
    failureTheme: caseDef.failureTheme,
    turnIndex,
    question: turn.question,
    historyLength: turn.history.length,
    status: result.status,
    answer: result.answer,
    standaloneQuestion: result.standaloneQuestion,
    unresolvedReferences: result.unresolvedReferences,
    rewriteMs: result.timingsMs.rewriteMs,
    retrievedChunkIds: result.retrievedChunks.map((h) => h.chunkId),
    retrievedFileNames: result.retrievedChunks.map(
      (h) => h.relativePath || h.documentId || h.chunkId,
    ),
    contextChunkIds: result.contextChunks.map((c) => c.chunkId),
    contextFileNames: result.contextChunks.map(
      (c) => c.relativePath || c.documentId || c.chunkId,
    ),
    contextOrigins: result.contextChunks.map((c) => c.origin),
    applicabilityPromptLines:
      result.contextMeta.applicability?.promptLines ?? [],
    enrichmentOmissions: result.contextMeta.enrichmentOmissions ?? [],
    omittedRetrieved: result.contextMeta.omittedRetrieved,
    answerParts: result.answerParts,
    citedChunkIds: result.sources.map((s) => s.chunkId),
    citedFileNames,
    citedSectionPaths,
    citationNumbersUniqueInAnswer: uniqueCitationNumbers(result.answerParts),
    sourceCardsDistinguishVersions: versionsDistinguishable(citedFileNames),
    sectionPathPresent: citedSectionPaths.some((p) => (p?.length ?? 0) > 0),
    standaloneChecks,
    observedFailure: turn.observedFailure,
    sourceNotes: turn.sourceNotes,
    suggestedLayer: hint.layer,
    layerEvidence: hint.evidence,
  };
}

async function diagnoseTurn(
  caseDef: ManualFailCase,
  turn: ManualFailTurn,
  turnIndex: number,
  askOptions: AskOptions,
  deps: AskDependencies,
): Promise<TurnDiagnosis> {
  try {
    const result = await ask(
      turn.question,
      {
        ...askOptions,
        history: turn.history,
        answerReviewEnabled: false,
        traceSource: "eval",
      },
      deps,
    );
    return summarizeResult(caseDef, turn, turnIndex, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      caseId: caseDef.id,
      title: caseDef.title,
      failureTheme: caseDef.failureTheme,
      turnIndex,
      question: turn.question,
      historyLength: turn.history.length,
      status: "system_error",
      answer: "",
      standaloneQuestion: "",
      unresolvedReferences: [],
      retrievedChunkIds: [],
      retrievedFileNames: [],
      contextChunkIds: [],
      contextFileNames: [],
      contextOrigins: [],
      applicabilityPromptLines: [],
      enrichmentOmissions: [],
      omittedRetrieved: [],
      answerParts: [],
      citedChunkIds: [],
      citedFileNames: [],
      citedSectionPaths: [],
      citationNumbersUniqueInAnswer: true,
      sourceCardsDistinguishVersions: true,
      sectionPathPresent: false,
      observedFailure: turn.observedFailure,
      sourceNotes: turn.sourceNotes,
      systemError:
        error instanceof GenerationSystemError
          ? `[generation] ${message}`
          : message,
      suggestedLayer: "undetermined",
      layerEvidence: [`system_error: ${message}`],
    };
  }
}

export async function runManualFailDiagnosis(options?: {
  askOptions?: AskOptions;
  deps?: AskDependencies;
  cases?: ManualFailCase[];
}): Promise<ManualFailDiagnosisReport> {
  const cases = options?.cases ?? MANUAL_FAIL_CASES;
  const askOptions: AskOptions = {
    mode: "hybrid",
    topK: 5,
    answerReviewEnabled: false,
    ...options?.askOptions,
  };
  const deps = options?.deps ?? {};
  const turns: TurnDiagnosis[] = [];

  for (const caseDef of cases) {
    for (let i = 0; i < caseDef.turns.length; i++) {
      const turn = caseDef.turns[i]!;
      turns.push(await diagnoseTurn(caseDef, turn, i, askOptions, deps));
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    setId: MANUAL_FAIL_REGRESSION_SET_ID,
    stageLabel: "manual-fail-diagnosis",
    config: {
      retrievalMode: askOptions.mode ?? "hybrid",
      topK: askOptions.topK ?? 5,
      generationModel: askOptions.generationModel ?? "(default)",
      answerReviewEnabled: false,
    },
    turns,
  };
}

function toMarkdown(report: ManualFailDiagnosisReport): string {
  const lines: string[] = [
    `# Manual-fail diagnosis — ${report.setId}`,
    "",
    `Generated: ${report.generatedAt}`,
    `Config: mode=${report.config.retrievalMode} topK=${report.config.topK} review=${report.config.answerReviewEnabled}`,
    "",
    "| Case | Turn | Status | Suggested layer | Standalone (trunc) | Cited files |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  for (const t of report.turns) {
    lines.push(
      `| ${t.caseId} | ${t.turnIndex} | ${t.status} | ${t.suggestedLayer} | ${t.standaloneQuestion.slice(0, 60).replace(/\|/g, "/")} | ${t.citedFileNames.join(", ") || "—"} |`,
    );
  }
  lines.push("");
  for (const t of report.turns) {
    lines.push(`## ${t.caseId} turn ${t.turnIndex} — ${t.title}`);
    lines.push("");
    lines.push(`- theme: ${t.failureTheme}`);
    lines.push(`- question: ${t.question}`);
    lines.push(`- historyLength: ${t.historyLength}`);
    lines.push(`- status: ${t.status}`);
    lines.push(`- standaloneQuestion: ${t.standaloneQuestion || "—"}`);
    lines.push(
      `- unresolvedReferences: ${t.unresolvedReferences.join("; ") || "—"}`,
    );
    lines.push(`- retrieved: ${t.retrievedChunkIds.join(", ") || "—"}`);
    lines.push(`- context: ${t.contextChunkIds.join(", ") || "—"}`);
    lines.push(
      `- applicability lines: ${t.applicabilityPromptLines.length ? t.applicabilityPromptLines.join(" / ") : "—"}`,
    );
    lines.push(`- cited: ${t.citedChunkIds.join(", ") || "—"}`);
    lines.push(`- answer: ${t.answer || t.systemError || "—"}`);
    lines.push(`- suggestedLayer: ${t.suggestedLayer}`);
    lines.push(`- layerEvidence: ${t.layerEvidence.join("; ") || "—"}`);
    lines.push(`- observedFailure: ${t.observedFailure}`);
    lines.push(`- sourceNotes: ${t.sourceNotes}`);
    lines.push(
      `- sources UI: citationIdsUnique=${t.citationNumbersUniqueInAnswer} versionFilesDistinguishable=${t.sourceCardsDistinguishVersions} sectionPathPresent=${t.sectionPathPresent}`,
    );
    lines.push("");
  }
  return lines.join("\n");
}

export async function writeManualFailDiagnosisReport(
  report: ManualFailDiagnosisReport,
  outDir = defaultEvalDir(),
): Promise<{ jsonPath: string; mdPath: string }> {
  await mkdir(outDir, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, "-");
  const base = `manual-fail-diagnosis-${stamp}`;
  const jsonPath = path.join(outDir, `${base}.json`);
  const mdPath = path.join(outDir, `${base}.md`);
  await writeFile(jsonPath, JSON.stringify(report, null, 2), "utf8");
  await writeFile(mdPath, toMarkdown(report), "utf8");
  return { jsonPath, mdPath };
}
