/**
 * Live verification for computed temporal facts → generation (mini, review off).
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ask,
  getGenerationModel,
  getOpenAiApiKey,
  isAnswerReviewEnabled,
  loadEnv,
  MissingApiKeyError,
} from "../src/rag";

interface CaseSpec {
  id: string;
  runs: number;
  question: string;
  expect: {
    mustIncludeAny?: string[][];
    mustNotInclude?: string[];
    requireMissingPurchase?: boolean;
    requireAfterFourteenFromPurchase?: boolean;
    requireNoFeeDirect?: boolean;
    requireHours?: boolean;
    purchaseToCancelDays?: number;
  };
}

const CASES: CaseSpec[] = [
  {
    id: "T-start-only",
    runs: 1,
    question:
      "אני מבטל פוליסה בשנת 2026, עשרה ימים אחרי תחילת הביטוח, ולא הייתה תביעה. האם ינכו דמי טיפול?",
    expect: { requireMissingPurchase: true },
  },
  {
    id: "T-split-19-days",
    runs: 3,
    question:
      "רכישת הפוליסה הייתה ב-1.1.2026, תחילת הביטוח ב-10.1.2026, ואני מבטל ב-20.1.2026 ללא תביעה. האם ינכו דמי טיפול, וכמה?",
    expect: {
      purchaseToCancelDays: 19,
      requireAfterFourteenFromPurchase: true,
      mustIncludeAny: [["3%"], ["150"]],
      mustNotInclude: ["5%", "5 %"],
    },
  },
  {
    id: "T-split-other-over-14",
    runs: 1,
    question:
      "רכישת הפוליסה הייתה ב-5.2.2026, תחילת הביטוח ב-8.2.2026, ואני מבטל ב-25.2.2026 ללא תביעה. מה דמי הטיפול?",
    expect: {
      purchaseToCancelDays: 20,
      requireAfterFourteenFromPurchase: true,
      mustIncludeAny: [["3%"], ["150"]],
    },
  },
  {
    id: "T-within-14-direct",
    runs: 1,
    question:
      "רכישת הפוליסה הייתה ב-1.3.2026 ואני מבטל ב-8.3.2026 ללא תביעה. האם ינכו דמי טיפול?",
    expect: {
      purchaseToCancelDays: 7,
      requireNoFeeDirect: true,
      mustNotInclude: ["5%", "5 %"],
    },
  },
  {
    id: "T-hours-unaffected",
    runs: 1,
    question: "מה שעות הפעילות של מוקד שירות הלקוחות ביום שישי?",
    expect: {
      requireHours: true,
      mustIncludeAny: [["08:00", "8:00"], ["12:00"]],
    },
  },
];

function score(
  answer: string,
  status: string,
  facts: { daySpans?: Array<{ fromKind: string; calendarDays: number }>; missingOrUncertain?: string[] } | undefined,
  expect: CaseSpec["expect"],
): string[] {
  const failures: string[] = [];
  if (expect.purchaseToCancelDays != null) {
    const span = facts?.daySpans?.find((s) => s.fromKind === "purchase");
    if (!span || span.calendarDays !== expect.purchaseToCancelDays) {
      failures.push(
        `computed purchase→cancel days expected ${expect.purchaseToCancelDays}, got ${span?.calendarDays ?? "missing"}`,
      );
    }
  }
  if (expect.requireMissingPurchase) {
    const named =
      /מועד הרכישה|תאריך הרכישה/.test(answer) &&
      (/מהו?\s+מועד|חסר|לא\s*(נמסר|צוין)|אינם בהכרח|מועדים שונים|תלוי/.test(
        answer,
      ) ||
        status === "clarification_needed");
    if (!named) {
      failures.push("missing purchase-clock gap identification");
    }
    if (
      /(לכן|מכיוון).{0,40}תחילת הביטוח.{0,60}(ללא דמי|החזר מלא)/.test(answer) &&
      !/אם|תלוי|חסר|לא נמסר|אינם בהכרח/.test(answer)
    ) {
      failures.push("equates insurance start with purchase eligibility");
    }
  }
  if (expect.requireAfterFourteenFromPurchase) {
    if (!/אחרי\s*14|יותר\s*מ-?\s*14|מעבר\s*ל-?\s*14|לא\s*בתוך\s*14/.test(answer)) {
      failures.push("answer does not state after/beyond 14 days from purchase");
    }
    if (/בתוך\s*14\s*יום\s*ממועד\s*הרכישה/.test(answer) && !/לא\s*בתוך|אינו\s*בתוך|עברו/.test(answer)) {
      failures.push("answer still claims within 14 days of purchase");
    }
    if (/החזר מלא/.test(answer) && /ללא דמי טיפול|בלי דמי טיפול/.test(answer)) {
      if (/תקבל|זכאי|במקרה שלך/.test(answer)) {
        failures.push("promises full no-fee refund");
      }
    }
  }
  if (expect.requireNoFeeDirect) {
    if (status === "clarification_needed") {
      failures.push("unnecessary clarification");
    }
    if (
      !/(ללא דמי טיפול|בלי דמי טיפול|לא ינוכו|ללא ניכוי|אין ניכוי|לא מנכים)/.test(
        answer,
      )
    ) {
      failures.push("missing direct no-fee outcome");
    }
  }
  if (expect.requireHours) {
    if (facts?.daySpans?.length) {
      failures.push("hours question unexpectedly produced day spans");
    }
  }
  for (const group of expect.mustIncludeAny ?? []) {
    if (!group.some((n) => answer.includes(n))) {
      failures.push(`missing any of [${group.join("|")}]`);
    }
  }
  for (const n of expect.mustNotInclude ?? []) {
    if (answer.includes(n)) failures.push(`forbidden: ${n}`);
  }
  return failures;
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

  console.log(
    `verify computed temporal | model=${getGenerationModel()} review=${isAnswerReviewEnabled()}`,
  );

  const rows: unknown[] = [];
  for (const spec of CASES) {
    for (let run = 0; run < spec.runs; run++) {
      const result = await ask(spec.question, {
        mode: "hybrid",
        topK: 5,
        answerReviewEnabled: false,
        generationModel: "gpt-4.1-mini",
        traceSource: "eval",
      });
      const facts = result.contextMeta.computedTemporalFacts;
      const failures = score(
        result.answer,
        result.status,
        facts,
        spec.expect,
      );
      const ok = failures.length === 0;
      rows.push({
        id: spec.id,
        run,
        ok,
        failures,
        status: result.status,
        answer: result.answer,
        cited: result.sources.map((s) => s.chunkId),
        computedTemporalFacts: facts ?? null,
        latencyMs: result.timingsMs.totalMs,
        generationMs: result.timingsMs.generationMs,
        usage: result.usage ?? null,
      });
      console.log(
        `${ok ? "OK" : "!!"} ${spec.id}#${run} status=${result.status} ` +
          `days=${facts?.daySpans?.map((s) => `${s.fromKind}:${s.calendarDays}`).join(",") || "—"} ` +
          `${failures.join("; ") || ""}`,
      );
    }
  }

  const outDir = path.join(process.cwd(), "eval_results");
  await mkdir(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(outDir, `computed-temporal-verify-${stamp}.json`);
  await writeFile(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        model: "gpt-4.1-mini",
        answerReviewEnabled: false,
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
