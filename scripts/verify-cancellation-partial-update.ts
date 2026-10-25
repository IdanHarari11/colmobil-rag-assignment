import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ask,
  getGenerationModel,
  getOpenAiApiKey,
  isAnswerReviewEnabled,
  loadEnv,
  MissingApiKeyError,
  type AskResult,
  type ChatHistoryMessage,
} from "../src/rag";

/**
 * Focused verification for cancellation partial-update + time-base (clock) policy.
 * Reference expectations are for evaluators only — not passed to ask().
 */

interface CaseExpect {
  mustIncludeAny?: string[][];
  mustNotInclude?: string[];
  allowHistoricalFivePercent?: boolean;
  /** Case A: missing purchase clock; must not equate start with purchase. */
  requireMissingPurchaseClock?: boolean;
  /** Case B: cancel after 14 days from purchase despite 10 from insurance start. */
  requirePurchaseAfterFourteenDespiteStartTen?: boolean;
  /** Case C: direct fee answer; fail if unnecessary clarification. */
  requireDirectNoFee?: boolean;
  /** Case D: follow-up supplies purchase; decide without re-asking. */
  requireFollowUpDecision?: boolean;
  allowedStatuses?: Array<AskResult["status"]>;
}

interface CaseSpec {
  id: string;
  question: string;
  runs: number;
  referenceNotes: string;
  expect: CaseExpect;
  /** When set, run as follow-up after this prior user question (uses prior ask result as history). */
  followUpOf?: string;
}

const START_ONLY_QUESTION =
  "אני מבטל פוליסה בשנת 2026, עשרה ימים אחרי תחילת הביטוח, ולא הייתה תביעה. האם ינכו דמי טיפול?";

const CASES: CaseSpec[] = [
  {
    id: "C-clock-start-only-missing-purchase",
    runs: 3,
    question: START_ONLY_QUESTION,
    referenceNotes:
      "Source clock is מועד הרכישה; user gave תחילת הביטוח only. Must name missing purchase date; must not assume purchase = insurance start.",
    expect: {
      requireMissingPurchaseClock: true,
      mustNotInclude: [],
      allowHistoricalFivePercent: true,
      allowedStatuses: ["answered", "clarification_needed"],
    },
  },
  {
    id: "C-clock-split-dates-after-purchase-window",
    runs: 1,
    question:
      "רכישת הפוליסה הייתה ב-1.1.2026, תחילת הביטוח ב-10.1.2026, ואני מבטל ב-20.1.2026 ללא תביעה. האם ינכו דמי טיפול, וכמה?",
    referenceNotes:
      "20.1 is 19 days after purchase (after 14) but only 10 days after insurance start → 3%/150 applies.",
    expect: {
      mustIncludeAny: [["3%"], ["150"]],
      mustNotInclude: ["5%", "5 %"],
      requirePurchaseAfterFourteenDespiteStartTen: true,
      allowedStatuses: ["answered"],
    },
  },
  {
    id: "C-within-10-days-2026",
    runs: 1,
    question:
      "אני מבטל פוליסה בשנת 2026, עשרה ימים אחרי מועד הרכישה, ולא הייתה תביעה. האם ינכו דמי טיפול?",
    referenceNotes:
      "Within 14 days from purchase, no claim → full refund, no handling fee (2025 update). Direct answer; no unnecessary clarification.",
    expect: {
      mustIncludeAny: [
        [
          "ללא דמי טיפול",
          "בלי דמי טיפול",
          "לא ינוכו",
          "ללא ניכוי",
          "אין ניכוי",
          "לא מנכים",
        ],
      ],
      mustNotInclude: ["5%", "5 %"],
      requireDirectNoFee: true,
      allowedStatuses: ["answered"],
    },
  },
  {
    id: "C-clock-followup-purchase-also-ten-days",
    runs: 1,
    question: "הרכישה הייתה גם היא לפני עשרה ימים.",
    followUpOf: "C-clock-start-only-missing-purchase",
    referenceNotes:
      "Follow-up supplies purchase clock aligned with 10 days → decide no fee; do not re-ask for purchase date.",
    expect: {
      mustIncludeAny: [
        [
          "ללא דמי טיפול",
          "בלי דמי טיפול",
          "לא ינוכו",
          "ללא ניכוי",
          "אין ניכוי",
          "לא מנכים",
        ],
      ],
      mustNotInclude: ["5%", "5 %"],
      requireFollowUpDecision: true,
      allowedStatuses: ["answered"],
    },
  },
  {
    id: "C-after-14-days-2026",
    runs: 1,
    question:
      "אני מבטל פוליסה בשנת 2026, שלושים ימים אחרי מועד הרכישה, ללא תביעה. מה דמי הטיפול בהחזר?",
    referenceNotes: "After 14 days → pro-rata + 3% capped at 150 ₪ (not 5%).",
    expect: {
      mustIncludeAny: [["3%"], ["150"]],
      mustNotInclude: ["5%", "5 %"],
      allowedStatuses: ["answered"],
    },
  },
  {
    id: "C-unreplaced-rule",
    runs: 1,
    question:
      "לפי נוהל הביטול, באיזה טופס מגישים בקשת ביטול, ומה נשאר בתוקף מנוהל 2023 מעבר לסעיף חישוב ההחזר?",
    referenceNotes: "Form 4401 / cancel anytime — unreplaced 2023 rules still apply.",
    expect: {
      mustIncludeAny: [["4401"]],
      allowedStatuses: ["answered"],
    },
  },
];

function looksLikeReaskingPurchase(answer: string): boolean {
  return (
    /מה\s*מועד\s*הרכישה|מתי\s*(ה)?רכיש|תאריך\s*הרכישה|מועד\s*הרכישה\??\s*$/m.test(
      answer,
    ) ||
    (/חסר|לא\s*צוין|נדרש|צריך|אשמח\s*לדעת|מה\s*היה/.test(answer) &&
      /רכיש/.test(answer) &&
      !/ללא\s*(דמי|ניכוי)|לא\s*ינוכו|אין\s*ניכוי/.test(answer))
  );
}

function score(
  answer: string,
  status: AskResult["status"],
  spec: CaseExpect,
): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  if (spec.allowedStatuses && !spec.allowedStatuses.includes(status)) {
    failures.push(
      `status=${status} not in [${spec.allowedStatuses.join("|")}]`,
    );
  }
  for (const group of spec.mustIncludeAny ?? []) {
    if (!group.some((n) => answer.includes(n))) {
      failures.push(`missing any of [${group.join("|")}]`);
    }
  }
  for (const n of spec.mustNotInclude ?? []) {
    if (answer.includes(n)) failures.push(`forbidden: ${n}`);
  }
  if (/5\s*%/.test(answer)) {
    if (spec.allowHistoricalFivePercent) {
      const historical =
        /ישן|לשעבר|הוחלף|לפני\s*1\.1\.2025|נוהל\s*2023|former|superseded|אין לציין/.test(
          answer,
        );
      if (!historical) {
        failures.push("5% present without clear historical marking");
      }
    } else {
      failures.push("5% present");
    }
  }
  if (spec.requireMissingPurchaseClock) {
    const namesMissing =
      /מועד הרכישה|תאריך הרכישה|תאריך רכישה/.test(answer) &&
      /לא\s*(נמסר|צוין|ידוע)|חסר|נדרש|צריך|אם\s*(מועד|תאריך)\s*הרכישה|בהתאם\s*למועד\s*הרכישה|תלוי\s*ב/.test(
        answer,
      );
    const equatesClocksAsFact =
      /(?:לכן|מכיוון|כי|מאחר).{0,40}(?:תחילת הביטוח|10 ימים).{0,60}(?:בתוך 14|ללא דמי|לא ינוכו)/.test(
        answer,
      ) &&
      !/אם|ככל|בתנאי|רק אם|בהנחה|תלוי|לא נמסר|לא צוין|חסר/.test(answer);
    if (!namesMissing) {
      failures.push(
        "missing explicit note that purchase date/clock is absent and matters",
      );
    }
    if (equatesClocksAsFact) {
      failures.push(
        "treats insurance-start interval as sufficient for no-fee purchase-window eligibility",
      );
    }
  }
  if (spec.requirePurchaseAfterFourteenDespiteStartTen) {
    const afterPurchase =
      /אחרי\s*14|יותר\s*מ-?\s*14|מעבר\s*ל-?\s*14|לא\s*בתוך\s*14/.test(answer) &&
      /רכיש/.test(answer);
    const notesStartTen =
      /תחילת הביטוח|מתחילת/.test(answer) && /10|עשרה/.test(answer);
    if (!afterPurchase) {
      failures.push("missing that cancel is after 14 days from purchase");
    }
    if (!notesStartTen) {
      failures.push(
        "missing contrast that only ~10 days elapsed from insurance start",
      );
    }
  }
  if (spec.requireDirectNoFee) {
    if (status === "clarification_needed") {
      failures.push("unnecessary clarification_needed when purchase clock given");
    }
    if (
      /מה\s*מועד\s*הרכישה|מתי\s*(ה)?רכיש/.test(answer) &&
      !/כבר|נמסר|ציינת/.test(answer)
    ) {
      failures.push("asks for purchase date though already provided");
    }
  }
  if (spec.requireFollowUpDecision) {
    if (status !== "answered") {
      failures.push("follow-up should decide with status=answered");
    }
    if (looksLikeReaskingPurchase(answer) && status === "clarification_needed") {
      failures.push("re-asks for purchase after user supplied it");
    }
    // Soft: if still heavily hedging without deciding no-fee, fail via mustIncludeAny.
  }
  return { ok: failures.length === 0, failures };
}

async function runAsk(
  question: string,
  history?: readonly ChatHistoryMessage[],
): Promise<AskResult> {
  return ask(question, {
    mode: "hybrid",
    topK: 5,
    answerReviewEnabled: false,
    generationModel: "gpt-4.1-mini",
    traceSource: "eval",
    history,
  });
}

async function main(): Promise<void> {
  loadEnv(process.cwd());
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

  const model = getGenerationModel();
  console.log(
    `verify cancellation clocks + partial-update | model=${model} review=${isAnswerReviewEnabled()}`,
  );
  if (model !== "gpt-4.1-mini") {
    console.warn(`WARNING: expected active model gpt-4.1-mini, got ${model}`);
  }

  /** Last successful prior-turn result per case id (for follow-ups). */
  const priorById = new Map<string, AskResult>();
  const rows: unknown[] = [];

  for (const spec of CASES) {
    for (let run = 0; run < spec.runs; run++) {
      let history: ChatHistoryMessage[] | undefined;
      if (spec.followUpOf) {
        // Prefer a prior start-only run from this process; else seed a fresh prior turn.
        let prior = priorById.get(spec.followUpOf);
        if (!prior) {
          prior = await runAsk(START_ONLY_QUESTION);
          priorById.set(spec.followUpOf, prior);
        }
        history = [
          { role: "user", content: START_ONLY_QUESTION },
          { role: "assistant", content: prior.answer },
        ];
      }

      const result = await runAsk(spec.question, history);
      if (!spec.followUpOf) {
        priorById.set(spec.id, result);
      }

      const scored = score(result.answer, result.status, spec.expect);
      const row = {
        id: spec.id,
        run,
        status: result.status,
        ok: scored.ok,
        failures: scored.failures,
        answer: result.answer,
        cited: result.sources.map((s) => s.chunkId),
        contextIds: result.contextChunks.map((c) => c.chunkId),
        applicability: result.contextMeta.applicability?.promptLines,
        modelReturned: result.generationModel,
        referenceNotes: spec.referenceNotes,
        followUpOf: spec.followUpOf,
      };
      rows.push(row);
      console.log(
        `${scored.ok ? "OK" : "!!"} ${spec.id}#${run} status=${result.status} ` +
          `${scored.failures.join("; ") || ""}`,
      );
    }
  }

  const outDir = path.join(process.cwd(), "eval_results");
  await mkdir(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(
    outDir,
    `cancellation-clock-verify-${stamp}.json`,
  );
  await writeFile(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        activeModelRequested: "gpt-4.1-mini",
        envGenerationModel: model,
        answerReviewEnabled: false,
        promptChange:
          "generate.ts buildSystemPrompt rule 10 — source clock vs user-stated event/date",
        rows,
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`wrote ${path.relative(process.cwd(), outPath)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
