import { describe, expect, it } from "vitest";
import {
  extractUserTemporalFacts,
  governingPolicyDate,
  isOnOrAfter,
  isBefore,
} from "./dates";

describe("extractUserTemporalFacts", () => {
  it("extracts explicit issue date", () => {
    const facts = extractUserTemporalFacts([
      "פוליסת מקיף שהונפקה ב-1.3.2026 מה ההשתתפות?",
    ]);
    expect(facts.issue?.isoDate).toBe("2026-03-01");
    expect(facts.issue?.kindExplicit).toBe(true);
    expect(facts.event).toBeUndefined();
  });

  it("extracts issue on transition boundary day", () => {
    const facts = extractUserTemporalFacts([
      "הונפקה ב-1.3.2026",
    ]);
    expect(facts.issue?.isoDate).toBe("2026-03-01");
    expect(isOnOrAfter(facts.issue!, "2026-03-01")).toBe(true);
  });

  it("extracts issue before transition", () => {
    const facts = extractUserTemporalFacts(["הונפקה ב-28.2.2026"]);
    expect(isBefore(facts.issue!, "2026-03-01")).toBe(true);
  });

  it("prefers explicit renewal over older issue for governing date", () => {
    const facts = extractUserTemporalFacts([
      "פוליסה שהונפקה ב-1.1.2024 וחודשה ב-1.4.2026",
    ]);
    expect(facts.issue?.isoDate).toBe("2024-01-01");
    expect(facts.renewal?.isoDate).toBe("2026-04-01");
    const g = governingPolicyDate(facts);
    expect(g?.kind).toBe("renewal");
    expect(g?.date.isoDate).toBe("2026-04-01");
  });

  it("does not treat event date as issue/renewal", () => {
    const facts = extractUserTemporalFacts([
      "אירעה תאונה באפריל 2026 — מה ההשתתפות במקיף?",
    ]);
    expect(facts.issue).toBeUndefined();
    expect(facts.renewal).toBeUndefined();
    expect(facts.event?.yearMonth).toBe("2026-04");
  });

  it("keeps unspecified when no dates", () => {
    const facts = extractUserTemporalFacts(["מה ההשתתפות העצמית?"]);
    expect(facts.dateKindsUsed).toEqual([]);
  });

  it("marks same-month threshold as ambiguous without day", () => {
    const facts = extractUserTemporalFacts([
      "פוליסת מקיף שהונפקה במרץ 2026",
    ]);
    expect(facts.issue?.yearMonth).toBe("2026-03");
    expect(isOnOrAfter(facts.issue!, "2026-03-01")).toBeUndefined();
  });
});
