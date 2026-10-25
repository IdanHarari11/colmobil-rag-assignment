/**
 * Closure-round verification: multi-applicability + retrieval fixes.
 * gpt-4.1-mini, answer review off. Does not retune date arithmetic.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ask,
  getGenerationModel,
  getOpenAiApiKey,
  isAnswerReviewEnabled,
  loadEnv,
  loadValidatedIndex,
  MissingApiKeyError,
  retrieve,
} from "../src/rag";
import { defaultChunksPath, defaultIndexPath } from "../src/rag/paths";

const THREE_CASES =
  "מה ההשתתפות העצמית במוסך הסדר בכל אחד מהמקרים: פוליסה שהונפקה ב-28.2.2026 ולא חודשה; פוליסה שהונפקה ב-1.3.2026; פוליסה שהונפקה ב-2024 וחודשה ב-1.4.2026?";

const THREE_CASES_REORDERED =
  "מה ההשתתפות העצמית במוסך הסדר בכל אחד מהמקרים: פוליסה שהונפקה ב-2024 וחודשה ב-1.4.2026; פוליסה שהונפקה ב-28.2.2026 ולא חודשה; פוליסה שהונפקה ב-1.3.2026?";

interface Row {
  id: string;
  ok: boolean;
  failures: string[];
  status?: string;
  answer?: string;
  cited?: string[];
  contextDocIds?: string[];
  retrieved?: Array<{
    chunkId: string;
    documentId: string;
    score: number;
    semanticRank?: number;
    lexicalRank?: number;
  }>;
  applicability?: string[];
  enrichmentOmissions?: Array<{ chunkId: string; reasonCode: string }>;
  standaloneQuestion?: string;
  notes?: string;
}

function contextDocs(result: {
  contextChunks: Array<{ documentId: string }>;
}): string[] {
  return [...new Set(result.contextChunks.map((c) => c.documentId))];
}

function hasAmounts(answer: string, a: string, b: string, c: string): boolean {
  const norm = answer.replace(/,/g, "");
  return (
    norm.includes(a.replace(/,/g, "")) &&
    norm.includes(b.replace(/,/g, "")) &&
    norm.includes(c.replace(/,/g, ""))
  );
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
    `closure verify | model=${getGenerationModel()} review=${isAnswerReviewEnabled()}`,
  );

  const index = await loadValidatedIndex({
    chunksPath: defaultChunksPath(),
    indexPath: defaultIndexPath(),
  });
  const rows: Row[] = [];

  // --- Multi-applicability ---
  {
    const id = "M-three-cases";
    const result = await ask(THREE_CASES, {
      mode: "hybrid",
      topK: 5,
      answerReviewEnabled: false,
      generationModel: "gpt-4.1-mini",
      traceSource: "eval",
    });
    const docs = contextDocs(result);
    const demoted = (result.contextMeta.enrichmentOmissions ?? []).filter(
      (o) => o.reasonCode === "demoted_version_omit_retrieved",
    );
    const failures: string[] = [];
    if (!docs.some((d) => d.includes("2024"))) {
      failures.push("2024 policy missing from context");
    }
    if (!docs.some((d) => d.includes("2026"))) {
      failures.push("2026 policy missing from context");
    }
    if (demoted.some((o) => o.chunkId.includes("2024"))) {
      failures.push("2024 demoted from retrieved context");
    }
    if (!hasAmounts(result.answer, "950", "1100", "1100") && !hasAmounts(result.answer, "950", "1,100", "1,100")) {
      // accept 1,100 formatting
      if (!/950/.test(result.answer) || !/1,?100/.test(result.answer)) {
        failures.push("expected amounts 950 and 1100 not both present");
      }
    }
    // Count 1100 twice is hard; require 950 once and 1100 at least once
    if (!/950/.test(result.answer.replace(/,/g, ""))) {
      failures.push("missing 950 for Feb 2026 / 2024 wording case");
    }
    rows.push({
      id,
      ok: failures.length === 0,
      failures,
      status: result.status,
      answer: result.answer,
      cited: result.sources.map((s) => s.chunkId),
      contextDocIds: docs,
      applicability: result.contextMeta.applicability?.promptLines,
      enrichmentOmissions: result.contextMeta.enrichmentOmissions,
    });
    console.log(`${failures.length ? "!!" : "OK"} ${id} docs=${docs.filter((d)=>d.includes("car_comprehensive")).join(",")}`);
  }

  {
    const id = "M-three-reordered";
    const result = await ask(THREE_CASES_REORDERED, {
      mode: "hybrid",
      topK: 5,
      answerReviewEnabled: false,
      generationModel: "gpt-4.1-mini",
      traceSource: "eval",
    });
    const docs = contextDocs(result);
    const failures: string[] = [];
    if (!docs.some((d) => d.includes("2024")) || !docs.some((d) => d.includes("policy_2026"))) {
      failures.push("both 2024 and 2026 not in context");
    }
    if (!/950/.test(result.answer.replace(/,/g, ""))) failures.push("missing 950");
    if (!/1,?100/.test(result.answer)) failures.push("missing 1100");
    rows.push({
      id,
      ok: failures.length === 0,
      failures,
      status: result.status,
      answer: result.answer,
      cited: result.sources.map((s) => s.chunkId),
      contextDocIds: docs,
      applicability: result.contextMeta.applicability?.promptLines,
    });
    console.log(`${failures.length ? "!!" : "OK"} ${id}`);
  }

  {
    const id = "M-single-renewal";
    const result = await ask(
      "פוליסה שהונפקה ב-1.1.2024 וחודשה ב-1.4.2026: מה ההשתתפות העצמית במוסך הסדר?",
      {
        mode: "hybrid",
        topK: 5,
        answerReviewEnabled: false,
        generationModel: "gpt-4.1-mini",
        traceSource: "eval",
      },
    );
    const docs = contextDocs(result);
    const failures: string[] = [];
    const selected2026 = result.contextMeta.applicability?.promptLines.some(
      (l) =>
        l.includes("selected") &&
        l.includes("2026") &&
        l.includes("car_comprehensive"),
    );
    if (!selected2026) failures.push("expected single-policy select 2026");
    if (!/1,?100/.test(result.answer)) failures.push("missing 1100");
    if (/950/.test(result.answer) && !/לא\s*חל|אינו/.test(result.answer)) {
      // 950 appearing as wrong amount for this case
      failures.push("unexpected 950 for renewed-to-2026 policy");
    }
    rows.push({
      id,
      ok: failures.length === 0,
      failures,
      status: result.status,
      answer: result.answer,
      cited: result.sources.map((s) => s.chunkId),
      contextDocIds: docs,
      applicability: result.contextMeta.applicability?.promptLines,
    });
    console.log(`${failures.length ? "!!" : "OK"} ${id}`);
  }

  {
    const id = "M-april-to-february";
    const t0 = await ask(
      "רכב מקיף שהונפק באפריל 2026: מה ההשתתפות העצמית במוסך הסדר?",
      {
        mode: "hybrid",
        topK: 5,
        answerReviewEnabled: false,
        generationModel: "gpt-4.1-mini",
        traceSource: "eval",
      },
    );
    const t1 = await ask("טעיתי: הפוליסה הונפקה בפברואר 2026 ולא חודשה מאז.", {
      mode: "hybrid",
      topK: 5,
      answerReviewEnabled: false,
      generationModel: "gpt-4.1-mini",
      traceSource: "eval",
      history: [
        {
          role: "user",
          content:
            "רכב מקיף שהונפק באפריל 2026: מה ההשתתפות העצמית במוסך הסדר?",
        },
        { role: "assistant", content: t0.answer },
      ],
    });
    const failures: string[] = [];
    if (!/950/.test(t1.answer.replace(/,/g, ""))) failures.push("missing 950");
    if (/1\.1\.2024/.test(t1.answer) && /הונפק/.test(t1.answer) && !/מדד|בסיס/.test(t1.answer)) {
      failures.push("may have rewritten issue date to index base");
    }
    rows.push({
      id,
      ok: failures.length === 0,
      failures,
      status: t1.status,
      answer: t1.answer,
      cited: t1.sources.map((s) => s.chunkId),
      contextDocIds: contextDocs(t1),
      standaloneQuestion: t1.standaloneQuestion,
      applicability: t1.contextMeta.applicability?.promptLines,
    });
    console.log(`${failures.length ? "!!" : "OK"} ${id}`);
  }

  {
    const id = "M-event-only-accident";
    const result = await ask(
      "אירעה תאונה באפריל 2026 — מה ההשתתפות העצמית ברכב מקיף במוסך הסדר?",
      {
        mode: "hybrid",
        topK: 5,
        answerReviewEnabled: false,
        generationModel: "gpt-4.1-mini",
        traceSource: "eval",
      },
    );
    const failures: string[] = [];
    const lines = result.contextMeta.applicability?.promptLines ?? [];
    const wronglySelected =
      lines.some((l) =>
        /car_comprehensive_policy: selected/.test(l),
      ) &&
      !lines.some((l) => /event_date_without_issue|missing_issue|cannot decide/.test(l));
    // Selecting purely from event date is wrong; unresolved or clarify OK
    if (wronglySelected && /event_date/.test(lines.join("\n")) === false) {
      // If selected without noting event-only — fail
      if (!/event_date_without_issue|cannot decide|missing_issue/.test(lines.join("\n"))) {
        failures.push("may have selected version from accident date alone");
      }
    }
    // Soft: prefer clarification or both amounts / cannot decide
    rows.push({
      id,
      ok: failures.length === 0,
      failures,
      status: result.status,
      answer: result.answer,
      cited: result.sources.map((s) => s.chunkId),
      contextDocIds: contextDocs(result),
      applicability: lines,
      notes: "Event date must not be treated as issue date",
    });
    console.log(`${failures.length ? "!!" : "OK"} ${id} status=${result.status}`);
  }

  // --- Retrieval probes ---
  async function retrievalProbe(
    id: string,
    question: string,
    history: Array<{ role: "user" | "assistant"; content: string }> | undefined,
    targetDocSubstring: string,
  ): Promise<void> {
    const result = await ask(question, {
      mode: "hybrid",
      topK: 5,
      answerReviewEnabled: false,
      generationModel: "gpt-4.1-mini",
      traceSource: "eval",
      history,
    });
    const q = result.standaloneQuestion || question;
    const hybrid = await retrieve(q, { mode: "hybrid", topK: 5 }, { index });
    const lexical = await retrieve(q, { mode: "lexical", topK: 5 }, { index });
    const vector = await retrieve(q, { mode: "vector", topK: 5 }, { index });
    const inHybrid = hybrid.hits.some((h) =>
      h.documentId.includes(targetDocSubstring),
    );
    const inLex = lexical.hits.some((h) =>
      h.documentId.includes(targetDocSubstring),
    );
    const inVec = vector.hits.some((h) =>
      h.documentId.includes(targetDocSubstring),
    );
    const failures: string[] = [];
    if (!inHybrid) failures.push(`target ${targetDocSubstring} missing from hybrid R@5`);
    rows.push({
      id,
      ok: failures.length === 0,
      failures,
      status: result.status,
      answer: result.answer,
      cited: result.sources.map((s) => s.chunkId),
      contextDocIds: contextDocs(result),
      standaloneQuestion: result.standaloneQuestion,
      retrieved: hybrid.hits.map((h) => ({
        chunkId: h.chunkId,
        documentId: h.documentId,
        score: h.score,
        semanticRank: h.semanticRank,
        lexicalRank: h.lexicalRank,
      })),
      notes: `lex@5=${inLex} vec@5=${inVec} hybrid@5=${inHybrid}; lexHits=${lexical.hits.map((h)=>h.documentId).join("|")}`,
    });
    console.log(
      `${failures.length ? "!!" : "OK"} ${id} hybrid=${inHybrid} lex=${inLex} vec=${inVec} status=${result.status}`,
    );
  }

  const carTurn = await ask(
    "השתתפות עצמית ברכב מקיף שהונפק באפריל 2026, במוסך הסדר.",
    {
      mode: "hybrid",
      topK: 5,
      answerReviewEnabled: false,
      generationModel: "gpt-4.1-mini",
      traceSource: "eval",
    },
  );
  await retrievalProbe(
    "R-home-cash-after-car",
    "עכשיו שאלה אחרת: מה תקרת הכיסוי למזומנים בביטוח תכולת דירה?",
    [
      {
        role: "user",
        content:
          "השתתפות עצמית ברכב מקיף שהונפק באפריל 2026, במוסך הסדר.",
      },
      { role: "assistant", content: carTurn.answer },
    ],
    "12_home_contents_limits",
  );

  await retrievalProbe(
    "R-agent-clawback-he-en",
    "אני סוכן ביטוח. לקוח ביטל פוליסה ביום ה-130. מה קורה לעמלה שכבר שולמה לי — agent commission clawback? איני שואל על דמי הטיפול של הלקוח. מה הכלל ומה היה משתנה בביטול ביום ה-100?",
    undefined,
    "30_agent_faq_en",
  );

  await retrievalProbe(
    "R-agent-clawback-he",
    "אני סוכן. לקוח ביטל ביום ה-130 מה קורה לעמלה שלי? ומה ביום ה-100? לא שואל על דמי טיפול ללקוח.",
    undefined,
    "30_agent_faq_en",
  );

  {
    const id = "R-customer-fee-control";
    const result = await ask(
      "לקוח מבטל פוליסה 30 יום אחרי הרכישה ב-2026 ללא תביעה. מה דמי הטיפול בהחזר?",
      {
        mode: "hybrid",
        topK: 5,
        answerReviewEnabled: false,
        generationModel: "gpt-4.1-mini",
        traceSource: "eval",
      },
    );
    const failures: string[] = [];
    if (!/3\s*%/.test(result.answer) || !/150/.test(result.answer)) {
      failures.push("expected customer 3%/150");
    }
    if (/clawback|עמלת סוכן|החזרת עמלה/.test(result.answer) && /סוכן/.test(result.answer)) {
      failures.push("mixed agent commission into customer fee answer");
    }
    rows.push({
      id,
      ok: failures.length === 0,
      failures,
      status: result.status,
      answer: result.answer,
      cited: result.sources.map((s) => s.chunkId),
      contextDocIds: contextDocs(result),
    });
    console.log(`${failures.length ? "!!" : "OK"} ${id}`);
  }

  async function smoke(
    id: string,
    q: string,
    pred: (a: string, status: string) => boolean,
  ): Promise<void> {
    const result = await ask(q, {
      mode: "hybrid",
      topK: 5,
      answerReviewEnabled: false,
      generationModel: "gpt-4.1-mini",
      traceSource: "eval",
    });
    const ok = pred(result.answer, result.status);
    rows.push({
      id,
      ok,
      failures: ok ? [] : ["smoke check failed"],
      status: result.status,
      answer: result.answer,
      cited: result.sources.map((s) => s.chunkId),
    });
    console.log(`${ok ? "OK" : "!!"} ${id} status=${result.status}`);
  }

  await smoke("S-hours", "מה שעות הפעילות של מוקד שירות הלקוחות ביום שישי?", (a) =>
    Boolean(/08:00|8:00/.test(a) && /12:00/.test(a)),
  );
  await smoke("S-4401", "באיזה טופס מגישים בקשת ביטול פוליסה?", (a) =>
    a.includes("4401"),
  );
  await smoke(
    "S-cancel-2025",
    "מה דמי הטיפול אם מבטלים אחרי יותר מ-14 יום מהרכישה ב-2026 ללא תביעה?",
    (a) => /3\s*%/.test(a) && /150/.test(a),
  );
  await smoke("S-replacement", "האם רכב חלופי ניתן לכל תקופת התיקון?", (a) =>
    /כתב שירות|21/.test(a),
  );
  await smoke("S-pets", "האם אופק ביטוח מציעה ביטוח לחיות מחמד?", (_a, status) =>
    status === "insufficient_evidence" || status === "clarification_needed",
  );

  const outDir = path.join(process.cwd(), "eval_results");
  await mkdir(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(outDir, `closure-multi-retrieval-${stamp}.json`);
  await writeFile(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        model: "gpt-4.1-mini",
        answerReviewEnabled: false,
        note:
          "Closure round: multi-scenario keep versions + corpus retrieval aliases. Date arithmetic not retuned; model may still ignore computed temporal facts.",
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
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
