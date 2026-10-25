import { describe, expect, it } from "vitest";
import {
  buildComputedTemporalFacts,
  formatComputedTemporalFactsForPrompt,
  userTextsForTemporalExtraction,
} from "./computed-facts";

describe("buildComputedTemporalFacts", () => {
  it("extracts purchase / insurance_start / cancellation and computes 19 days", () => {
    const facts = buildComputedTemporalFacts([
      "רכישת הפוליסה הייתה ב-1.1.2026, תחילת הביטוח ב-10.1.2026, ואני מבטל ב-20.1.2026 ללא תביעה.",
    ]);
    expect(facts.events.map((e) => [e.kind, e.isoDate])).toEqual([
      ["purchase", "2026-01-01"],
      ["insurance_start", "2026-01-10"],
      ["cancellation", "2026-01-20"],
    ]);
    const purchaseSpan = facts.daySpans.find(
      (s) => s.fromKind === "purchase" && s.toKind === "cancellation",
    );
    expect(purchaseSpan?.calendarDays).toBe(19);
    expect(purchaseSpan?.orderOk).toBe(true);
    const startSpan = facts.daySpans.find(
      (s) => s.fromKind === "insurance_start" && s.toKind === "cancellation",
    );
    expect(startSpan?.calendarDays).toBe(10);
  });

  it("does not equate purchase with insurance_start", () => {
    const facts = buildComputedTemporalFacts([
      "תחילת הביטוח ב-10.1.2026 ואני מבטל ב-20.1.2026",
    ]);
    expect(facts.events.some((e) => e.kind === "purchase")).toBe(false);
    expect(facts.events.some((e) => e.kind === "insurance_start")).toBe(true);
    expect(
      facts.missingOrUncertain.some((m) => m.includes("purchase date not provided")),
    ).toBe(true);
  });

  it("does not fill missing purchase from insurance_start", () => {
    const facts = buildComputedTemporalFacts([
      "אני מבטל פוליסה בשנת 2026, עשרה ימים אחרי תחילת הביטוח, ולא הייתה תביעה.",
    ]);
    expect(facts.events).toEqual([]);
    expect(
      facts.missingOrUncertain.some((m) =>
        m.includes("do not assume purchase = insurance_start"),
      ),
    ).toBe(true);
  });

  it("marks reverse order as not orderOk", () => {
    const facts = buildComputedTemporalFacts([
      "רכישת הפוליסה הייתה ב-20.1.2026 ואני מבטל ב-1.1.2026",
    ]);
    const span = facts.daySpans.find((s) => s.fromKind === "purchase");
    expect(span?.calendarDays).toBe(-19);
    expect(span?.orderOk).toBe(false);
    expect(facts.missingOrUncertain.some((m) => /reversed/.test(m))).toBe(true);
  });

  it("does not emit certain fact for ambiguous same-kind dates", () => {
    const facts = buildComputedTemporalFacts([
      "רכישת הפוליסה הייתה ב-1.1.2026. רכישת הפוליסה הייתה ב-15.2.2026. ואני מבטל ב-20.1.2026",
    ]);
    expect(facts.events.some((e) => e.kind === "purchase")).toBe(false);
    expect(facts.unsupportedNotes.some((n) => /Ambiguous purchase/.test(n))).toBe(
      true,
    );
  });

  it("does not mix dates across separate user turns into one unlabeled binding", () => {
    // Each labeled date stays with its label; assistant text is excluded by caller.
    const facts = buildComputedTemporalFacts([
      "רכישת הפוליסה הייתה ב-1.3.2025",
      "תחילת הביטוח ב-10.1.2026, ואני מבטל ב-20.1.2026",
    ]);
    expect(facts.events.find((e) => e.kind === "purchase")?.isoDate).toBe(
      "2025-03-01",
    );
    expect(
      facts.events.find((e) => e.kind === "insurance_start")?.isoDate,
    ).toBe("2026-01-10");
    // purchase→cancel span uses the labeled purchase from the prior user turn.
    expect(
      facts.daySpans.find((s) => s.fromKind === "purchase")?.fromIso,
    ).toBe("2025-03-01");
  });

  it("skips invalid calendar dates", () => {
    const facts = buildComputedTemporalFacts([
      "רכישת הפוליסה הייתה ב-32.1.2026 ואני מבטל ב-20.1.2026",
    ]);
    expect(facts.events.some((e) => e.kind === "purchase")).toBe(false);
  });

  it("prompt block has no fee amounts or canned eligibility", () => {
    const facts = buildComputedTemporalFacts([
      "רכישת הפוליסה הייתה ב-1.1.2026 ואני מבטל ב-20.1.2026",
    ]);
    const block = formatComputedTemporalFactsForPrompt(facts).join("\n");
    expect(block).toMatch(/Calendar days from purchase/);
    expect(block).toMatch(/\b19\b/);
    expect(block).not.toMatch(/3%/);
    expect(block).not.toMatch(/150/);
    expect(block).not.toMatch(/החזר מלא/);
  });
});

describe("userTextsForTemporalExtraction", () => {
  it("includes only user roles", () => {
    const texts = userTextsForTemporalExtraction({
      question: "ואני מבטל ב-20.1.2026",
      history: [
        { role: "user", content: "רכישת הפוליסה הייתה ב-1.1.2026" },
        {
          role: "assistant",
          content: "תחילת הביטוח ב-10.1.2026 (invented assistant date)",
        },
      ],
    });
    expect(texts.join("\n")).toContain("רכישת הפוליסה הייתה ב-1.1.2026");
    expect(texts.join("\n")).not.toContain("invented assistant date");
  });
});
