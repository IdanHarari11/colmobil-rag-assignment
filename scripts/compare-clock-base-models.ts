/**
 * Focused generation-only experiment: remaining cancellation clock-base failures.
 * Does not change RAG / prompts / app defaults. Answer review stays off.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DOCUMENTED_MODEL_PRICES_USD_PER_MTIE,
  type ComparedModelId,
} from "../src/eval/generation-model-comparison";
import {
  ask,
  getGenerationModel,
  getOpenAiApiKey,
  isAnswerReviewEnabled,
  loadEnv,
  MissingApiKeyError,
  type AskResult,
} from "../src/rag";
import type { ApplicabilitySummary } from "../src/rag/document-relations/types";
import {
  buildSystemPrompt,
  buildUserPrompt,
  generateGroundedAnswer,
  type GenerateAnswerResult,
} from "../src/rag/generate";

const ROOT = process.cwd();
const MODELS: ComparedModelId[] = ["gpt-4.1-mini", "gpt-5.6-terra"];
const RUNS = 3;
const SAVED_VERIFY =
  "eval_results/cancellation-clock-verify-2026-10-22T07-29-53-428Z.json";

const Q_A =
  "אני מבטל פוליסה בשנת 2026, עשרה ימים אחרי תחילת הביטוח, ולא הייתה תביעה. האם ינכו דמי טיפול?";
const Q_B =
  "רכישת הפוליסה הייתה ב-1.1.2026, תחילת הביטוח ב-10.1.2026, ואני מבטל ב-20.1.2026 ללא תביעה. האם ינכו דמי טיפול, וכמה?";
const Q_CTRL =
  "אני מבטל פוליסה בשנת 2026, עשרה ימים אחרי מועד הרכישה, ולא הייתה תביעה. האם ינכו דמי טיפול?";

type CaseId = "CLOCK-A" | "CLOCK-B" | "CTRL-purchase-10";

interface FrozenCase {
  id: CaseId;
  kind: "probe" | "control";
  question: string;
  standaloneQuestion: string;
  unresolvedReferences: string[];
  contextChunkIds: string[];
  applicabilityPromptLines: string[];
  systemPrompt: string;
  userPrompt: string;
  systemPromptSha256: string;
  userPromptSha256: string;
  inputBundleSha256: string;
  preGenerationIssues: string[];
  /** Skip model comparison when pre-generation layer is at fault. */
  skipModelComparison: boolean;
  captureAskStatus: string;
  captureModelReturned: string;
  /** Full ask capture retained for generation-only replay (chunks + applicability). */
  capture: AskResult;
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function missingOrNumber(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Cost from documented list prices. Does not invent zeros for missing API fields.
 * Reasoning tokens are not added on top of completion (provider usually includes them).
 */
function costFromUsage(
  model: ComparedModelId,
  usage: GenerateAnswerResult["usage"] | undefined,
): {
  costUsd: number | null;
  costNotes: string[];
  uncachedInputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
} {
  const prices = DOCUMENTED_MODEL_PRICES_USD_PER_MTIE[model];
  const prompt = missingOrNumber(usage?.promptTokens);
  const cached = missingOrNumber(usage?.cachedInputTokens);
  const output = missingOrNumber(usage?.completionTokens);
  const reasoning = missingOrNumber(usage?.reasoningTokens);
  const notes: string[] = [];
  if (prompt === null) notes.push("promptTokens missing");
  if (cached === null) notes.push("cachedInputTokens missing (not assumed 0)");
  if (output === null) notes.push("completionTokens missing");
  if (reasoning === null) notes.push("reasoningTokens missing (not assumed 0)");

  if (prompt === null || output === null) {
    return {
      costUsd: null,
      costNotes: [...notes, "cost not computable"],
      uncachedInputTokens: null,
      cachedInputTokens: cached,
      outputTokens: output,
      reasoningTokens: reasoning,
    };
  }

  // When cache split unknown, treat all prompt as uncached and mark unverifiable for cache.
  const uncached =
    cached === null ? prompt : Math.max(0, prompt - cached);
  if (cached === null) {
    notes.push(
      "cost assumes all prompt tokens uncached — cache-sensitive total not fully verifiable",
    );
  }
  const costUsd =
    (uncached / 1_000_000) * prices.input +
    ((cached ?? 0) / 1_000_000) * prices.cachedInput +
    (output / 1_000_000) * prices.output;
  // Do not add reasoningTokens again — they are part of completion when reported.

  return {
    costUsd,
    costNotes: notes,
    uncachedInputTokens: uncached,
    cachedInputTokens: cached,
    outputTokens: output,
    reasoningTokens: reasoning,
  };
}

function auditPreGeneration(input: {
  id: CaseId;
  question: string;
  standaloneQuestion: string;
  applicabilityPromptLines: string[];
  userPrompt: string;
}): string[] {
  const issues: string[] = [];
  const q = input.question;
  const stand = input.standaloneQuestion;
  const app = input.applicabilityPromptLines.join("\n");
  const user = input.userPrompt;

  if (input.id === "CLOCK-A") {
    if (!/תחילת הביטוח/.test(q)) {
      issues.push("layer=question: missing תחילת הביטוח");
    }
    if (/מועד הרכישה|תאריך הרכישה|תאריך רכישה/.test(q)) {
      issues.push("layer=question: purchase date unexpectedly present");
    }
    // Standalone must not invent a purchase date / equate clocks.
    if (
      /רכיש[^\n]{0,40}(לפני עשרה|לפני 10|עשרה ימים)/.test(stand) ||
      /מועד הרכישה[^\n]{0,30}תחילת הביטוח|תחילת הביטוח[^\n]{0,30}מועד הרכישה/.test(
        stand,
      )
    ) {
      issues.push(
        "layer=standaloneQuestion: appears to equate purchase with insurance start or invent purchase timing",
      );
    }
  }

  if (input.id === "CLOCK-B") {
    for (const needle of ["1.1.2026", "10.1.2026", "20.1.2026"] as const) {
      if (!q.includes(needle)) {
        issues.push(`layer=question: missing explicit date ${needle}`);
      }
    }
    // Wrong day-count or wrong branch asserted before generation.
    const preGenText = `${stand}\n${app}\n${user}`;
    if (
      /בתוך\s*14\s*יום/.test(stand) &&
      /רכיש/.test(stand) &&
      !/אחרי\s*14|יותר\s*מ-?\s*14|19/.test(stand)
    ) {
      issues.push(
        "layer=standaloneQuestion: asserts within-14-from-purchase despite calendar dates implying 19 days",
      );
    }
    if (/19\s*יום/.test(app) && /בתוך\s*14/.test(app)) {
      issues.push(
        "layer=applicability: contradictory day-count / branch in metadata",
      );
    }
    // Applicability should not hard-assert fee branch for this fact pattern.
    if (/אין דמי טיפול|ללא דמי טיפול|החזר מלא/.test(app)) {
      issues.push(
        "layer=applicability: fee-branch determination present in metadata (unexpected)",
      );
    }
    void preGenText;
  }

  return issues;
}

function scoreCase(
  caseId: CaseId,
  result: GenerateAnswerResult,
): { passed: boolean; failures: string[]; notes: string[] } {
  const text = result.payload.answerParts.map((p) => p.text).join("\n");
  const status = result.payload.status;
  const failures: string[] = [];
  const notes: string[] = [`status=${status} (status alone does not decide pass/fail)`];

  if (caseId === "CLOCK-A") {
    // Asking for purchase date, or stating it is missing / clocks differ, counts.
    const namesMissing =
      /מהו?\s+מועד\s+הרכיש|מה\s+מועד\s+(הרכישה|רכיש)|מועד\s+רכישת\s+הפוליסה\?/.test(
        text,
      ) ||
      (/מועד הרכישה|תאריך הרכישה|תאריך רכישה/.test(text) &&
        /לא\s*(נמסר|צוין|ידוע)|חסר|נדרש|צריך|אם\s*(מועד|תאריך)\s*הרכישה|תלוי\s*ב|בהתאם\s*למועד|אינם בהכרח|מועדים שונים/.test(
          text,
        ));
    if (!namesMissing) {
      failures.push("does not explicitly state purchase date/clock is missing");
    }
    const equates =
      /תחילת הביטוח.{0,50}(היא|זהה|שווה|גם).{0,30}(רכיש|מועד הרכישה)/.test(
        text,
      ) ||
      (/(לכן|מכיוון|כי|מאחר).{0,50}תחילת הביטוח.{0,80}(ללא דמי|לא ינוכו|החזר מלא)/.test(
        text,
      ) &&
        !/אם|ככל|בתנאי|רק אם|בהנחה|תלוי|לא נמסר|לא צוין|חסר|אינם בהכרח|מועדים שונים|מהו?\s+מועד/.test(
          text,
        ));
    if (equates) {
      failures.push("assumes insurance start equals purchase");
    }
  }

  if (caseId === "CLOCK-B") {
    const days19 =
      /19/.test(text) ||
      /יותר\s*מ-?\s*14|אחרי\s*14|מעבר\s*ל-?\s*14|לא\s*בתוך\s*14/.test(text);
    if (!days19) {
      failures.push("does not identify >14 / 19 days from purchase");
    }
    if (!/3\s*%/.test(text) || !/150/.test(text)) {
      failures.push("missing updated fee 3% and/or 150 ₪");
    }
    if (
      /החזר מלא/.test(text) &&
      /ללא דמי טיפול|בלי דמי טיפול|לא ינוכו/.test(text) &&
      !/לא\s*(זכאי|חל)|אין\s*החזר מלא|לא\s*מקבל\s*החזר מלא/.test(text)
    ) {
      // Promising full no-fee refund for this case is a fail.
      if (/במקרה שלך|תקבל|זכאי|לכן.*ללא דמי/.test(text)) {
        failures.push("promises full refund without handling fee");
      }
    }
    if (/בתוך\s*14\s*יום\s*ממועד\s*הרכישה/.test(text) && !/לא\s*בתוך|אינו\s*בתוך|עברו\s*יותר/.test(text)) {
      failures.push("incorrectly places cancel within 14 days of purchase");
    }
  }

  if (caseId === "CTRL-purchase-10") {
    if (status === "clarification_needed") {
      failures.push("unnecessary clarification when purchase clock given");
    }
    if (
      !/(ללא דמי טיפול|בלי דמי טיפול|לא ינוכו|ללא ניכוי|אין ניכוי|לא מנכים)/.test(
        text,
      )
    ) {
      failures.push("missing direct no-fee outcome");
    }
    if (/5\s*%/.test(text)) failures.push("leaked 5%");
  }

  return { passed: failures.length === 0, failures, notes };
}

async function captureFrozenCase(
  id: CaseId,
  question: string,
  kind: "probe" | "control",
): Promise<FrozenCase> {
  const capture = await ask(question, {
    mode: "hybrid",
    topK: 5,
    answerReviewEnabled: false,
    // Capture uses active mini — does not change app default; generation compare overrides model.
    generationModel: "gpt-4.1-mini",
    traceSource: "eval",
  });

  const allowedIds = capture.contextChunks.map((c) => c.chunkId);
  const systemPrompt = buildSystemPrompt(allowedIds);
  const userPrompt = buildUserPrompt(question, capture.contextChunks, {
    standaloneQuestion: capture.standaloneQuestion,
    unresolvedReferences: capture.unresolvedReferences,
    applicabilitySummary: capture.contextMeta.applicability,
  });

  const applicabilityPromptLines =
    capture.contextMeta.applicability?.promptLines ?? [];
  const preGenerationIssues = auditPreGeneration({
    id,
    question,
    standaloneQuestion: capture.standaloneQuestion,
    applicabilityPromptLines,
    userPrompt,
  });

  const systemPromptSha256 = sha256(systemPrompt);
  const userPromptSha256 = sha256(userPrompt);
  const inputBundleSha256 = sha256(
    JSON.stringify({
      question,
      standaloneQuestion: capture.standaloneQuestion,
      unresolvedReferences: capture.unresolvedReferences,
      contextChunkIds: allowedIds,
      applicabilityPromptLines,
      systemPromptSha256,
      userPromptSha256,
    }),
  );

  return {
    id,
    kind,
    question,
    standaloneQuestion: capture.standaloneQuestion,
    unresolvedReferences: capture.unresolvedReferences,
    contextChunkIds: allowedIds,
    applicabilityPromptLines,
    systemPrompt,
    userPrompt,
    systemPromptSha256,
    userPromptSha256,
    inputBundleSha256,
    preGenerationIssues,
    skipModelComparison: preGenerationIssues.length > 0,
    captureAskStatus: capture.status,
    captureModelReturned: capture.generationModel,
    capture,
  };
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

  const envModel = getGenerationModel();
  console.log(
    `clock-base model compare | env GENERATION_MODEL=${envModel} review=${isAnswerReviewEnabled()}`,
  );
  if (envModel !== "gpt-4.1-mini") {
    console.warn(
      "WARNING: app env model is not gpt-4.1-mini — experiment still requests models explicitly; not writing .env",
    );
  }

  // --- 1. Validate saved verify questions (answers are not generation inputs) ---
  const saved = JSON.parse(
    await readFile(path.join(ROOT, SAVED_VERIFY), "utf8"),
  ) as {
    rows: Array<{ id: string; answer: string; contextIds?: string[] }>;
    promptChange?: string;
  };
  const savedA = saved.rows.find(
    (r) => r.id === "C-clock-start-only-missing-purchase",
  );
  const savedB = saved.rows.find(
    (r) => r.id === "C-clock-split-dates-after-purchase-window",
  );
  const savedInputAudit = {
    note:
      "Prior verify JSON stored answers/contextIds/applicability lines but not standaloneQuestion or full prompts. " +
      "Mini answers from that run are NOT reused as same-input baselines; this experiment freezes inputs via ask() capture then generation-only.",
    savedPromptChange: saved.promptChange ?? null,
    caseA_questionExpected: Q_A,
    caseA_savedHadStartOnlyQuestion: Boolean(savedA),
    caseB_datesInQuestionScript: {
      purchase: "1.1.2026",
      insuranceStart: "10.1.2026",
      cancel: "20.1.2026",
    },
    caseB_savedPresent: Boolean(savedB),
  };

  // --- 2. Freeze current final prompts + full inputs ---
  console.log("Capturing frozen generation inputs (ask once per case)…");
  const frozen = [
    await captureFrozenCase("CLOCK-A", Q_A, "probe"),
    await captureFrozenCase("CLOCK-B", Q_B, "probe"),
    await captureFrozenCase("CTRL-purchase-10", Q_CTRL, "control"),
  ];

  for (const f of frozen) {
    console.log(
      `  ${f.id}: preGenIssues=${f.preGenerationIssues.length} skipCompare=${f.skipModelComparison} ` +
        `sys=${f.systemPromptSha256.slice(0, 12)}… user=${f.userPromptSha256.slice(0, 12)}…`,
    );
    if (f.preGenerationIssues.length) {
      for (const issue of f.preGenerationIssues) console.log(`    !! ${issue}`);
    }
  }

  // --- 3. Generation-only runs ---
  const rows: unknown[] = [];
  for (const f of frozen) {
    if (f.skipModelComparison) {
      console.log(
        `SKIP model comparison for ${f.id} — pre-generation issue (not scored as Generation failure)`,
      );
      rows.push({
        caseId: f.id,
        skipped: true,
        skipReason: "pre_generation_input_error",
        preGenerationIssues: f.preGenerationIssues,
      });
      continue;
    }

    for (const model of MODELS) {
      for (let runIndex = 0; runIndex < RUNS; runIndex++) {
        console.log(`run ${f.id} / ${model} / #${runIndex}`);
        try {
          const result = await generateGroundedAnswer({
            question: f.question,
            standaloneQuestion: f.standaloneQuestion,
            unresolvedReferences: f.unresolvedReferences,
            contextChunks: f.capture.contextChunks,
            applicabilitySummary: f.capture.contextMeta.applicability as
              | ApplicabilitySummary
              | undefined,
            model,
            // Same Terra settings as prior experiment: default medium via sampling profile.
          });
          const scored = scoreCase(f.id, result);
          const cost = costFromUsage(model, result.usage);
          rows.push({
            caseId: f.id,
            model,
            runIndex,
            skipped: false,
            status: result.payload.status,
            passed: scored.passed,
            failures: scored.failures,
            scoreNotes: scored.notes,
            answer: result.payload.answerParts.map((p) => p.text).join("\n\n"),
            answerParts: result.payload.answerParts,
            citedChunkIds: [
              ...new Set(
                result.payload.answerParts.flatMap((p) => p.sourceChunkIds),
              ),
            ],
            latencyMs: result.latencyMs,
            modelRequested: result.modelRequested,
            modelReturned: result.modelReturned,
            samplingProfile: result.samplingProfile,
            reasoningEffortSent: result.reasoningEffortSent ?? null,
            usageRaw: result.usage ?? null,
            usage: {
              promptTokens: missingOrNumber(result.usage?.promptTokens),
              completionTokens: missingOrNumber(result.usage?.completionTokens),
              totalTokens: missingOrNumber(result.usage?.totalTokens),
              cachedInputTokens: missingOrNumber(
                result.usage?.cachedInputTokens,
              ),
              reasoningTokens: missingOrNumber(result.usage?.reasoningTokens),
            },
            costUsd: cost.costUsd,
            costNotes: cost.costNotes,
            uncachedInputTokens: cost.uncachedInputTokens,
            inputHashes: {
              systemPromptSha256: f.systemPromptSha256,
              userPromptSha256: f.userPromptSha256,
              inputBundleSha256: f.inputBundleSha256,
            },
          });
          console.log(
            `  → ${scored.passed ? "PASS" : "FAIL"} status=${result.payload.status} ` +
              `returned=${result.modelReturned} reason=${result.reasoningEffortSent ?? "n/a"} ` +
              `${scored.failures.join("; ") || ""}`,
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          rows.push({
            caseId: f.id,
            model,
            runIndex,
            skipped: false,
            status: "system_error",
            passed: false,
            failures: [message],
            answer: "",
            modelRequested: model,
            modelReturned: null,
            reasoningEffortSent: null,
            usage: {
              promptTokens: null,
              completionTokens: null,
              totalTokens: null,
              cachedInputTokens: null,
              reasoningTokens: null,
            },
            costUsd: null,
            costNotes: ["system_error"],
            inputHashes: {
              systemPromptSha256: f.systemPromptSha256,
              userPromptSha256: f.userPromptSha256,
              inputBundleSha256: f.inputBundleSha256,
            },
            systemError: message,
          });
          console.log(`  → ERROR ${message}`);
        }
      }
    }
  }

  // Snapshot without huge duplicate: store prompts once + chunk ids (full prompts for audit).
  const snapshot = {
    createdAt: new Date().toISOString(),
    note:
      "Frozen generation inputs for clock-base A/B + purchase-10 control. " +
      "App default GENERATION_MODEL left unchanged. Answer review off. No RAG/prompt edits in this experiment.",
    envGenerationModel: envModel,
    answerReviewEnabled: isAnswerReviewEnabled(),
    terraSettings:
      "reasoning_family profile: omit temperature; reasoning_effort=medium (same default as prior comparison)",
    savedInputAudit,
    cases: frozen.map((f) => ({
      id: f.id,
      kind: f.kind,
      question: f.question,
      standaloneQuestion: f.standaloneQuestion,
      unresolvedReferences: f.unresolvedReferences,
      contextChunkIds: f.contextChunkIds,
      applicabilityPromptLines: f.applicabilityPromptLines,
      systemPromptSha256: f.systemPromptSha256,
      userPromptSha256: f.userPromptSha256,
      inputBundleSha256: f.inputBundleSha256,
      preGenerationIssues: f.preGenerationIssues,
      skipModelComparison: f.skipModelComparison,
      systemPrompt: f.systemPrompt,
      userPrompt: f.userPrompt,
    })),
  };

  const comparison = {
    generatedAt: new Date().toISOString(),
    pricingSource:
      "https://developers.openai.com/api/docs/pricing (standard short-context)",
    priceTable: DOCUMENTED_MODEL_PRICES_USD_PER_MTIE,
    rows,
  };

  const outDir = path.join(ROOT, "eval_results");
  await mkdir(outDir, { recursive: true });
  const stamp = comparison.generatedAt.replace(/[:.]/g, "-");
  const snapshotPath = path.join(
    outDir,
    `clock-base-model-snapshot-${stamp}.json`,
  );
  const jsonPath = path.join(outDir, `clock-base-model-compare-${stamp}.json`);
  const mdPath = path.join(outDir, `clock-base-model-compare-${stamp}.md`);

  await writeFile(snapshotPath, JSON.stringify(snapshot, null, 2), "utf8");
  await writeFile(jsonPath, JSON.stringify(comparison, null, 2), "utf8");
  await writeFile(
    mdPath,
    toMarkdown(snapshot, comparison as { generatedAt: string; rows: Array<Record<string, unknown>>; pricingSource: string }),
    "utf8",
  );

  console.log(`snapshot: ${path.relative(ROOT, snapshotPath)}`);
  console.log(`JSON: ${path.relative(ROOT, jsonPath)}`);
  console.log(`Markdown: ${path.relative(ROOT, mdPath)}`);

  // Console summary
  for (const caseId of ["CLOCK-A", "CLOCK-B", "CTRL-purchase-10"] as const) {
    for (const model of MODELS) {
      const subset = (rows as Array<Record<string, unknown>>).filter(
        (r) => r.caseId === caseId && r.model === model && !r.skipped,
      );
      if (!subset.length) {
        console.log(`${caseId} / ${model}: skipped or no rows`);
        continue;
      }
      const pass = subset.filter((r) => r.passed).length;
      console.log(`${caseId} / ${model}: ${pass}/${subset.length}`);
    }
  }
}

function toMarkdown(
  snapshot: {
    createdAt: string;
    note: string;
    envGenerationModel: string;
    terraSettings: string;
    savedInputAudit: unknown;
    cases: Array<{
      id: string;
      skipModelComparison: boolean;
      preGenerationIssues: string[];
      systemPromptSha256: string;
      userPromptSha256: string;
      standaloneQuestion: string;
      question: string;
    }>;
  },
  comparison: {
    generatedAt: string;
    pricingSource: string;
    rows: Array<Record<string, unknown>>;
  },
): string {
  const lines: string[] = [
    `# Clock-base generation model comparison`,
    "",
    `Generated: ${comparison.generatedAt}`,
    `Snapshot: ${snapshot.createdAt}`,
    `Env GENERATION_MODEL (unchanged): ${snapshot.envGenerationModel}`,
    `Terra settings: ${snapshot.terraSettings}`,
    `Pricing: ${comparison.pricingSource}`,
    "",
    snapshot.note,
    "",
    "## 1. Input validation",
    "",
    "```json",
    JSON.stringify(snapshot.savedInputAudit, null, 2),
    "```",
    "",
  ];

  for (const c of snapshot.cases) {
    lines.push(`### ${c.id}`);
    lines.push(`- question: ${c.question}`);
    lines.push(`- standaloneQuestion: ${c.standaloneQuestion}`);
    lines.push(`- systemPromptSha256: \`${c.systemPromptSha256}\``);
    lines.push(`- userPromptSha256: \`${c.userPromptSha256}\``);
    if (c.preGenerationIssues.length) {
      lines.push(`- **PRE-GENERATION ISSUES (model compare skipped):**`);
      for (const i of c.preGenerationIssues) lines.push(`  - ${i}`);
    } else {
      lines.push(`- pre-generation audit: OK`);
    }
    lines.push("");
  }

  lines.push("## 2. Summary (passes / 3)", "");
  lines.push("| Case | Model | Passes |", "| --- | --- | --- |");
  for (const caseId of ["CLOCK-A", "CLOCK-B", "CTRL-purchase-10"]) {
    for (const model of MODELS) {
      const subset = comparison.rows.filter(
        (r) => r.caseId === caseId && r.model === model && !r.skipped,
      );
      if (!subset.length) {
        lines.push(`| ${caseId} | ${model} | skipped |`);
        continue;
      }
      const pass = subset.filter((r) => r.passed).length;
      lines.push(`| ${caseId} | ${model} | ${pass}/${subset.length} |`);
    }
  }

  lines.push(
    "",
    "## 3. Per-run detail (full answers)",
    "",
    "This focused experiment does **not** imply all date-handling issues are solved.",
    "",
  );

  for (const r of comparison.rows) {
    if (r.skipped) {
      lines.push(`### ${r.caseId} — SKIPPED (pre-generation)`);
      lines.push(`- issues: ${JSON.stringify(r.preGenerationIssues)}`);
      lines.push("");
      continue;
    }
    lines.push(
      `### ${r.caseId} / ${r.model} / run ${r.runIndex} — ${r.passed ? "PASS" : "FAIL"}`,
    );
    lines.push(
      `- requested=${r.modelRequested} returned=${r.modelReturned ?? "—"} reasoningEffortSent=${r.reasoningEffortSent ?? "missing"}`,
    );
    lines.push(
      `- status=${r.status} latencyMs=${r.latencyMs} usage=${JSON.stringify(r.usage)} costUsd=${r.costUsd ?? "unverifiable"}`,
    );
    if (Array.isArray(r.costNotes) && r.costNotes.length) {
      lines.push(`- costNotes: ${(r.costNotes as string[]).join("; ")}`);
    }
    lines.push(`- hashes: ${JSON.stringify(r.inputHashes)}`);
    if (Array.isArray(r.failures) && r.failures.length) {
      lines.push(`- failures: ${(r.failures as string[]).join("; ")}`);
    }
    lines.push(`- cited: ${JSON.stringify(r.citedChunkIds ?? [])}`);
    lines.push("");
    lines.push(String(r.answer || r.systemError || "—"));
    lines.push("");
  }

  return lines.join("\n");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
