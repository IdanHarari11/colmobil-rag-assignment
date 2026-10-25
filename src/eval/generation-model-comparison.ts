import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ContextChunk } from "../rag/ask-types";
import type { ApplicabilitySummary } from "../rag/document-relations/types";
import {
  estimateTokens,
  TOKEN_ESTIMATE_METHOD,
} from "../chunking/estimate-tokens";
import {
  generateGroundedAnswer,
  type GenerateAnswerResult,
} from "../rag/generate";
import { loadValidatedIndex } from "../rag/index-store";
import {
  defaultChunksPath,
  defaultEvalDir,
  defaultIndexPath,
} from "../rag/paths";
import type { ChatCompletionSamplingProfile } from "../rag/model-request-params";
import { ask } from "../rag/ask";
import { MANUAL_FAIL_CASES } from "./manual-fail-regression-fixtures";

/** Documented OpenAI standard short-context prices (USD / 1M tokens), 2026-10. */
export const DOCUMENTED_MODEL_PRICES_USD_PER_MTIE = {
  "gpt-4.1-mini": { input: 0.4, cachedInput: 0.1, output: 1.6 },
  "gpt-5.6-terra": { input: 2.0, cachedInput: 0.2, output: 12.0 },
} as const;

export type ComparedModelId = keyof typeof DOCUMENTED_MODEL_PRICES_USD_PER_MTIE;

export interface GenerationSnapshotCase {
  id: string;
  title: string;
  kind: "probe" | "control";
  /** Frozen generation inputs — identical for every model/run. */
  question: string;
  standaloneQuestion: string;
  unresolvedReferences: string[];
  contextChunks: ContextChunk[];
  applicabilitySummary?: ApplicabilitySummary;
  /** Evaluation notes (not sent to the model). */
  evalNotes: string;
  /** Soft pass checks applied to Hebrew answer text / status. */
  checks: {
    mustIncludeAny?: string[][];
    mustNotInclude?: string[];
    preferStatus?: Array<"answered" | "clarification_needed" | "insufficient_evidence">;
    /** Custom named checks evaluated in code. */
    named?: string[];
  };
}

export interface GenerationSnapshot {
  createdAt: string;
  sourceDiagnosisReport?: string;
  note: string;
  cases: GenerationSnapshotCase[];
}

function packEstimate(chunk: ContextChunk): number {
  const block = [
    `chunkId=${chunk.chunkId}`,
    chunk.documentTitle ?? "",
    (chunk.sectionPath ?? []).join(" > "),
    chunk.text,
  ].join("\n");
  return estimateTokens(block);
}

function toApplicability(
  promptLines: string[] | undefined,
): ApplicabilitySummary | undefined {
  if (!promptLines?.length) return undefined;
  return {
    manifestVersion: 1,
    userTemporal: {
      hasIssueDate: false,
      hasRenewalDate: false,
      hasEventDate: false,
      dateKindsUsed: [],
    },
    versionDecisions: [],
    activatedRelationships: [],
    unresolvedNotes: [],
    promptLines,
  };
}

async function contextFromChunkIds(
  chunkIds: string[],
  origins: string[] | undefined,
): Promise<ContextChunk[]> {
  const index = await loadValidatedIndex({
    chunksPath: defaultChunksPath(),
    indexPath: defaultIndexPath(),
  });
  const byId = new Map(index.items.map((i) => [i.chunkId, i]));
  const out: ContextChunk[] = [];
  for (let i = 0; i < chunkIds.length; i++) {
    const id = chunkIds[i]!;
    const item = byId.get(id);
    if (!item) {
      throw new Error(`Snapshot build: missing chunk ${id} in index`);
    }
    const meta = item.chunk.metadata;
    const origin = (origins?.[i] as ContextChunk["origin"]) ?? "retrieved";
    const base: ContextChunk = {
      chunkId: item.chunkId,
      documentId: meta.documentId,
      relativePath: meta.relativePath,
      text: item.chunk.text,
      embeddingText: item.embeddingText,
      documentTitle: meta.documentTitle,
      sectionPath: meta.sectionPath,
      pages: meta.pages,
      warnings: meta.warnings ?? [],
      origin,
      estimatedTokens: 0,
    };
    base.estimatedTokens = packEstimate(base);
    out.push(base);
  }
  return out;
}

/**
 * Build a shared generation snapshot from the manual-fail diagnosis report
 * (context ids + frozen standalone) plus live ask once for control cases.
 */
export async function buildSharedGenerationSnapshot(options: {
  diagnosisJsonPath: string;
  captureControlsWithModel?: string;
}): Promise<GenerationSnapshot> {
  const diagnosis = JSON.parse(
    await readFile(options.diagnosisJsonPath, "utf8"),
  ) as {
    turns: Array<{
      caseId: string;
      turnIndex: number;
      question: string;
      standaloneQuestion: string;
      unresolvedReferences: string[];
      contextChunkIds: string[];
      contextOrigins: string[];
      applicabilityPromptLines: string[];
      status: string;
    }>;
  };

  const cases: GenerationSnapshotCase[] = [];

  // MF-B turns 0..2, MF-D, MF-F from diagnosis (frozen).
  for (const key of [
    { caseId: "MF-B", turnIndex: 0 },
    { caseId: "MF-B", turnIndex: 1 },
    { caseId: "MF-B", turnIndex: 2 },
    { caseId: "MF-D", turnIndex: 0 },
    { caseId: "MF-F", turnIndex: 0 },
  ] as const) {
    const turn = diagnosis.turns.find(
      (t) => t.caseId === key.caseId && t.turnIndex === key.turnIndex,
    );
    if (!turn || !turn.contextChunkIds?.length) {
      throw new Error(
        `Diagnosis missing generation inputs for ${key.caseId}#${key.turnIndex}`,
      );
    }
    const fixture = MANUAL_FAIL_CASES.find((c) => c.id === key.caseId);
    const contextChunks = await contextFromChunkIds(
      turn.contextChunkIds,
      turn.contextOrigins,
    );
    const id = `${key.caseId}-t${key.turnIndex}`;
    cases.push({
      id,
      title: fixture?.title ?? id,
      kind: "probe",
      question: turn.question,
      standaloneQuestion: turn.standaloneQuestion || turn.question,
      unresolvedReferences: turn.unresolvedReferences ?? [],
      contextChunks,
      applicabilitySummary: toApplicability(turn.applicabilityPromptLines),
      evalNotes: fixture?.turns[key.turnIndex]?.sourceNotes ?? "",
      checks: checksForProbe(key.caseId, key.turnIndex),
    });
  }

  // Controls: capture context once with the freeze model (not compared as retrieval).
  const controlModel = options.captureControlsWithModel ?? "gpt-4.1-mini";
  const controls: Array<{
    id: string;
    title: string;
    question: string;
    checks: GenerationSnapshotCase["checks"];
    evalNotes: string;
  }> = [
    {
      id: "CTRL-hours",
      title: "שעות מוקד בשישי",
      question: "מה שעות הפעילות של מוקד שירות הלקוחות ביום שישי?",
      evalNotes: "Expect 08:00–12:00 from call-center hours doc.",
      checks: {
        preferStatus: ["answered"],
        mustIncludeAny: [["08:00", "8:00"], ["12:00"]],
        mustNotInclude: ["09:00–14:00", "09:00-14:00"],
      },
    },
    {
      id: "CTRL-replacement",
      title: "סתירת עלון מול כתב שירות רכב חלופי",
      question: "האם רכב חלופי ניתן לכל תקופת התיקון?",
      evalNotes:
        "Binding rider wins over marketing brochure; not for entire repair without rider.",
      checks: {
        preferStatus: ["answered"],
        mustIncludeAny: [["כתב שירות"], ["21"]],
        named: ["prefers_binding_over_marketing"],
      },
    },
    {
      id: "CTRL-pets",
      title: "הימנעות מביטוח חיות מחמד",
      question: "האם אופק ביטוח מציעה ביטוח לחיות מחמד?",
      evalNotes: "Corpus has no pet product — insufficient_evidence, no invention.",
      checks: {
        preferStatus: ["insufficient_evidence"],
        mustNotInclude: ["OfekPets", "מציעה ביטוח לחיות"],
        named: ["no_invented_pet_product"],
      },
    },
  ];

  for (const ctrl of controls) {
    const result = await ask(ctrl.question, {
      mode: "hybrid",
      topK: 5,
      generationModel: controlModel,
      answerReviewEnabled: false,
      traceSource: "eval",
    });
    cases.push({
      id: ctrl.id,
      title: ctrl.title,
      kind: "control",
      question: ctrl.question,
      standaloneQuestion: result.standaloneQuestion,
      unresolvedReferences: result.unresolvedReferences,
      contextChunks: result.contextChunks,
      applicabilitySummary: result.contextMeta.applicability,
      evalNotes: ctrl.evalNotes,
      checks: ctrl.checks,
    });
  }

  return {
    createdAt: new Date().toISOString(),
    sourceDiagnosisReport: options.diagnosisJsonPath,
    note:
      "Shared generation inputs. Probe cases rebuilt from diagnosis chunk ids + index text. " +
      "Controls captured once via ask() with freeze model for context only; comparison reuses frozen context.",
    cases,
  };
}

function checksForProbe(
  caseId: string,
  turnIndex: number,
): GenerationSnapshotCase["checks"] {
  if (caseId === "MF-B" && turnIndex === 0) {
    return {
      preferStatus: ["answered"],
      mustIncludeAny: [["1,100", "1100", "1.100"]],
      named: ["keeps_april_or_2026_issue"],
    };
  }
  if (caseId === "MF-B" && turnIndex === 1) {
    return {
      preferStatus: ["answered"],
      mustIncludeAny: [["950"]],
      named: ["keeps_february_2026_user_date", "no_issue_date_rewritten_to_index_base"],
    };
  }
  if (caseId === "MF-B" && turnIndex === 2) {
    return {
      preferStatus: ["answered"],
      mustIncludeAny: [["1,850", "1850", "1.850"]],
      named: ["keeps_february_2026_user_date", "no_issue_date_rewritten_to_index_base"],
    };
  }
  if (caseId === "MF-D") {
    return {
      preferStatus: ["answered"],
      mustNotInclude: ["5%", "5 %"],
      named: ["uses_updated_fee_not_old_5pct", "separates_purchase_vs_start_if_needed"],
    };
  }
  if (caseId === "MF-F") {
    return {
      preferStatus: ["answered"],
      mustIncludeAny: [["300"], ["220"]],
      named: ["applies_220_under_cumulative_300", "no_automatic_payment_promise"],
    };
  }
  return {};
}

export interface RunScore {
  passed: boolean;
  failures: string[];
}

export function scoreGenerationCase(
  snap: GenerationSnapshotCase,
  result: GenerateAnswerResult,
): RunScore {
  const failures: string[] = [];
  const text = result.payload.answerParts.map((p) => p.text).join("\n");
  const status = result.payload.status;

  if (snap.checks.preferStatus?.length) {
    if (!snap.checks.preferStatus.includes(status)) {
      failures.push(
        `status=${status} not in [${snap.checks.preferStatus.join(",")}]`,
      );
    }
  }
  for (const group of snap.checks.mustIncludeAny ?? []) {
    if (!group.some((needle) => text.includes(needle))) {
      failures.push(`missing any of [${group.join("|")}]`);
    }
  }
  for (const needle of snap.checks.mustNotInclude ?? []) {
    if (text.includes(needle)) {
      failures.push(`forbidden phrase: ${needle}`);
    }
  }

  for (const name of snap.checks.named ?? []) {
    if (name === "keeps_february_2026_user_date") {
      if (!/פברואר\s*2026|02\/2026|2\/2026/.test(text) && !/פברואר/.test(text)) {
        // Allow "לפני 1.3.2026" only if February also present; otherwise fail soft on date wipe.
        if (/1\.1\.2024/.test(text) && !/פברואר/.test(text)) {
          failures.push("user February 2026 issue date not preserved");
        }
      }
    }
    if (name === "no_issue_date_rewritten_to_index_base") {
      // "גרסת 2024" alone is OK; claiming the policy was issued on 1.1.2024 is not.
      if (
        /הונפק[ה]?[^\n.]{0,40}1\.1\.2024/.test(text) ||
        /תאריך הנפקה[^\n.]{0,40}1\.1\.2024/.test(text)
      ) {
        failures.push("issue date rewritten to index base 1.1.2024");
      }
    }
    if (name === "keeps_april_or_2026_issue") {
      if (!/אפריל|2026/.test(text)) {
        failures.push("April/2026 issue signal missing");
      }
    }
    if (name === "uses_updated_fee_not_old_5pct") {
      if (/5\s*%/.test(text) && !/אין לציין|לא לציין/.test(text)) {
        failures.push("leaked superseded 5% handling fee");
      }
      if (status === "answered" && !/3\s*%|ללא דמי טיפול|בלי דמי טיפול/.test(text)) {
        failures.push("updated 3% / no-fee rule not clearly stated");
      }
    }
    if (name === "separates_purchase_vs_start_if_needed") {
      // Soft: if answering about 14-day clock, prefer purchase wording from source.
      if (/14/.test(text) && /תחילת הביטוח/.test(text) && !/רכיש/.test(text)) {
        failures.push(
          "equated insurance-start with purchase clock without source support",
        );
      }
    }
    if (name === "applies_220_under_cumulative_300") {
      if (/220/.test(text) && /150/.test(text) && !/300/.test(text)) {
        failures.push("applied 150 only; ignored cumulative 300 ceiling");
      }
      if (
        /220/.test(text) &&
        /עד\s*150/.test(text) &&
        /החזר בפועל יהיה עד 150/.test(text)
      ) {
        failures.push("capped reimbursement at 150 despite 300 cumulative ceiling");
      }
      // Success signal: 220 under 300 without promising auto pay
      if (/220/.test(text) && /300/.test(text)) {
        // ok
      } else if (!/220/.test(text)) {
        failures.push("did not address user amount 220");
      }
    }
    if (name === "no_automatic_payment_promise") {
      if (/תשלום מובטח|זכאים אוטומטית|יועבר אוטומטית/.test(text)) {
        failures.push("promised automatic payment/eligibility");
      }
    }
    if (name === "prefers_binding_over_marketing") {
      if (/לכל תקופת התיקון/.test(text) && !/כתב שירות|מוסך הסדר|21/.test(text)) {
        failures.push("may have followed marketing blanket claim");
      }
    }
    if (name === "no_invented_pet_product") {
      if (status === "answered" && /חיות מחמד/.test(text) && /מציע|קיים|כולל/.test(text)) {
        failures.push("invented or affirmed pet product");
      }
    }
  }

  // Citation validity: ids must be in context
  const allowed = new Set(snap.contextChunks.map((c) => c.chunkId));
  for (const part of result.payload.answerParts) {
    for (const id of part.sourceChunkIds) {
      if (!allowed.has(id)) {
        failures.push(`invalid citation id ${id}`);
      }
    }
    if (
      status === "answered" &&
      part.text.trim() &&
      part.sourceChunkIds.length === 0 &&
      !/^\?/.test(part.text)
    ) {
      // Allow clarification-style empties only when status is clarification
      failures.push("answered part without sourceChunkIds");
    }
  }

  return { passed: failures.length === 0, failures };
}

export function estimateCostUsd(
  model: ComparedModelId,
  usage?: GenerateAnswerResult["usage"],
): number {
  const prices = DOCUMENTED_MODEL_PRICES_USD_PER_MTIE[model];
  const prompt = usage?.promptTokens ?? 0;
  const cached = usage?.cachedInputTokens ?? 0;
  const uncached = Math.max(0, prompt - cached);
  const completion = usage?.completionTokens ?? 0;
  return (
    (uncached / 1_000_000) * prices.input +
    (cached / 1_000_000) * prices.cachedInput +
    (completion / 1_000_000) * prices.output
  );
}

export interface ComparisonRunRow {
  caseId: string;
  model: ComparedModelId;
  runIndex: number;
  status: string;
  passed: boolean;
  failures: string[];
  answerPreview: string;
  latencyMs: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  costUsd: number;
  modelRequested: string;
  modelReturned: string;
  samplingProfile: ChatCompletionSamplingProfile;
  reasoningEffortSent?: string;
  systemError?: string;
}

export async function runGenerationComparison(options: {
  snapshot: GenerationSnapshot;
  models: ComparedModelId[];
  runsPerCase: number;
}): Promise<{
  generatedAt: string;
  snapshotCreatedAt: string;
  tokenEstimateMethod: string;
  pricingSource: string;
  rows: ComparisonRunRow[];
}> {
  const rows: ComparisonRunRow[] = [];
  for (const model of options.models) {
    for (const snapCase of options.snapshot.cases) {
      for (let runIndex = 0; runIndex < options.runsPerCase; runIndex++) {
        try {
          const result = await generateGroundedAnswer({
            question: snapCase.question,
            standaloneQuestion: snapCase.standaloneQuestion,
            unresolvedReferences: snapCase.unresolvedReferences,
            contextChunks: snapCase.contextChunks,
            applicabilitySummary: snapCase.applicabilitySummary,
            model,
          });
          const score = scoreGenerationCase(snapCase, result);
          rows.push({
            caseId: snapCase.id,
            model,
            runIndex,
            status: result.payload.status,
            passed: score.passed,
            failures: score.failures,
            answerPreview: result.payload.answerParts
              .map((p) => p.text)
              .join(" ")
              .slice(0, 500),
            latencyMs: result.latencyMs,
            promptTokens: result.usage?.promptTokens,
            completionTokens: result.usage?.completionTokens,
            totalTokens: result.usage?.totalTokens,
            reasoningTokens: result.usage?.reasoningTokens,
            costUsd: estimateCostUsd(model, result.usage),
            modelRequested: result.modelRequested,
            modelReturned: result.modelReturned,
            samplingProfile: result.samplingProfile,
            reasoningEffortSent: result.reasoningEffortSent,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          rows.push({
            caseId: snapCase.id,
            model,
            runIndex,
            status: "system_error",
            passed: false,
            failures: [message],
            answerPreview: "",
            latencyMs: 0,
            costUsd: 0,
            modelRequested: model,
            modelReturned: "",
            samplingProfile: { kind: "classic_sampling", temperature: 0 },
            systemError: message,
          });
        }
      }
    }
  }
  return {
    generatedAt: new Date().toISOString(),
    snapshotCreatedAt: options.snapshot.createdAt,
    tokenEstimateMethod: TOKEN_ESTIMATE_METHOD,
    pricingSource:
      "https://developers.openai.com/api/docs/pricing (standard short-context)",
    rows,
  };
}

export async function writeGenerationComparisonArtifacts(
  snapshot: GenerationSnapshot,
  comparison: Awaited<ReturnType<typeof runGenerationComparison>>,
  outDir = defaultEvalDir(),
): Promise<{ snapshotPath: string; jsonPath: string; mdPath: string }> {
  await mkdir(outDir, { recursive: true });
  const stamp = comparison.generatedAt.replace(/[:.]/g, "-");
  const snapshotPath = path.join(
    outDir,
    `generation-comparison-snapshot-${stamp}.json`,
  );
  // Omit full chunk text duplication in a slim companion? Keep full for audit.
  await writeFile(snapshotPath, JSON.stringify(snapshot, null, 2), "utf8");

  const jsonPath = path.join(outDir, `generation-comparison-${stamp}.json`);
  await writeFile(jsonPath, JSON.stringify(comparison, null, 2), "utf8");

  const mdPath = path.join(outDir, `generation-comparison-${stamp}.md`);
  await writeFile(mdPath, toComparisonMarkdown(snapshot, comparison), "utf8");
  return { snapshotPath, jsonPath, mdPath };
}

function toComparisonMarkdown(
  snapshot: GenerationSnapshot,
  comparison: Awaited<ReturnType<typeof runGenerationComparison>>,
): string {
  const lines: string[] = [
    `# Generation model comparison`,
    "",
    `Generated: ${comparison.generatedAt}`,
    `Snapshot: ${comparison.snapshotCreatedAt}`,
    `Pricing: ${comparison.pricingSource}`,
    "",
    "## Summary table",
    "",
    "| Case | Model | Passes / runs | Remaining failure | Avg ms | Avg tokens | Avg cost USD |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];

  const caseIds = [...new Set(comparison.rows.map((r) => r.caseId))];
  const models = [...new Set(comparison.rows.map((r) => r.model))];
  for (const caseId of caseIds) {
    for (const model of models) {
      const subset = comparison.rows.filter(
        (r) => r.caseId === caseId && r.model === model,
      );
      const passes = subset.filter((r) => r.passed).length;
      const failSample =
        subset.find((r) => !r.passed)?.failures.join("; ") ?? "—";
      const avgMs =
        subset.reduce((s, r) => s + r.latencyMs, 0) / Math.max(1, subset.length);
      const avgTok =
        subset.reduce((s, r) => s + (r.totalTokens ?? 0), 0) /
        Math.max(1, subset.length);
      const avgCost =
        subset.reduce((s, r) => s + r.costUsd, 0) / Math.max(1, subset.length);
      lines.push(
        `| ${caseId} | ${model} | ${passes}/${subset.length} | ${failSample.slice(0, 80)} | ${avgMs.toFixed(0)} | ${avgTok.toFixed(0)} | ${avgCost.toFixed(4)} |`,
      );
    }
  }

  lines.push("", "## Out of scope for generation swap", "");
  lines.push(
    "- MF-A: 2024 demotion (`demoted_version_omit_retrieved`) — context/applicability fix.",
  );
  lines.push("- MF-C: home contents retrieval miss — retrieval/clarify policy fix.");
  lines.push("- MF-E: English agent FAQ miss — retrieval fix.");
  lines.push("", "## Cases in snapshot", "");
  for (const c of snapshot.cases) {
    lines.push(
      `- **${c.id}** (${c.kind}): ${c.title} — contextChunks=${c.contextChunks.length}`,
    );
  }
  lines.push("", "## Per-run detail", "");
  for (const r of comparison.rows) {
    lines.push(
      `### ${r.caseId} / ${r.model} / run ${r.runIndex} — ${r.passed ? "PASS" : "FAIL"}`,
    );
    lines.push(
      `- requested=${r.modelRequested} returned=${r.modelReturned || "—"} reasoning=${r.reasoningEffortSent ?? "n/a"}`,
    );
    lines.push(
      `- status=${r.status} ms=${r.latencyMs.toFixed(0)} tokens=${r.totalTokens ?? "—"} (reason=${r.reasoningTokens ?? 0}) cost≈$${r.costUsd.toFixed(5)}`,
    );
    if (r.failures.length) lines.push(`- failures: ${r.failures.join("; ")}`);
    lines.push(`- preview: ${r.answerPreview || r.systemError || "—"}`);
    lines.push("");
  }
  return lines.join("\n");
}
