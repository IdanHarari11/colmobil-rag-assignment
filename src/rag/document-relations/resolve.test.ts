import { describe, expect, it } from "vitest";
import { extractUserTemporalFacts } from "./dates";
import { loadDocumentRelationsManifest } from "./load-manifest";
import { resolveVersionDecisions } from "./resolve";

const FAMILY_IDS = new Set([
  "corpus/01_car_comprehensive_policy_2024",
  "corpus/02_car_comprehensive_policy_2026",
  "corpus/22_cancellation_procedure_2023",
  "corpus/23_cancellation_procedure_update_2025",
  "corpus/09_marketing_brochure_car",
]);

describe("resolveVersionDecisions (deterministic corpus rules)", () => {
  it("selects 2024 before transition, 2026 on/after, renewal after transition", async () => {
    const manifest = await loadDocumentRelationsManifest();

    const before = resolveVersionDecisions(
      manifest,
      extractUserTemporalFacts(["הונפקה ב-28.2.2026"]),
      FAMILY_IDS,
    ).find((d) => d.documentFamily === "car_comprehensive_policy");
    expect(before?.selectedDocumentId).toContain("2024");
    expect(before?.reasonCode).toContain("before");

    const onDay = resolveVersionDecisions(
      manifest,
      extractUserTemporalFacts(["הונפקה ב-1.3.2026"]),
      FAMILY_IDS,
    ).find((d) => d.documentFamily === "car_comprehensive_policy");
    expect(onDay?.selectedDocumentId).toContain("2026");

    const after = resolveVersionDecisions(
      manifest,
      extractUserTemporalFacts(["הונפקה באפריל 2026"]),
      FAMILY_IDS,
    ).find((d) => d.documentFamily === "car_comprehensive_policy");
    // April 2026 month-only is after March threshold month → selected 2026
    expect(after?.selectedDocumentId).toContain("2026");

    const renewed = resolveVersionDecisions(
      manifest,
      extractUserTemporalFacts([
        "הונפקה ב-1.1.2024 וחודשה ב-15.3.2026",
      ]),
      FAMILY_IDS,
    ).find((d) => d.documentFamily === "car_comprehensive_policy");
    expect(renewed?.selectedDocumentId).toContain("2026");
    expect(renewed?.dateKindUsed).toBe("renewal");
  });

  it("leaves car version unresolved for event-only or missing dates", async () => {
    const manifest = await loadDocumentRelationsManifest();
    const eventOnly = resolveVersionDecisions(
      manifest,
      extractUserTemporalFacts(["אירעה תאונה באפריל 2026"]),
      FAMILY_IDS,
    ).find((d) => d.documentFamily === "car_comprehensive_policy");
    expect(eventOnly?.status).toBe("unresolved");
    expect(eventOnly?.reasonCode).toBe("event_date_without_issue_or_renewal");

    const missing = resolveVersionDecisions(
      manifest,
      extractUserTemporalFacts(["מה ההשתתפות במקיף?"]),
      FAMILY_IDS,
    ).find((d) => d.documentFamily === "car_comprehensive_policy");
    expect(missing?.status).toBe("unresolved");
  });

  it("keeps cancellation base + partial update together", async () => {
    const manifest = await loadDocumentRelationsManifest();
    const decision = resolveVersionDecisions(
      manifest,
      extractUserTemporalFacts(["מה ההחזר בביטול אחרי 14 יום?"]),
      FAMILY_IDS,
    ).find((d) => d.documentFamily === "cancellation_procedure");
    expect(decision?.status).toBe("partial_update");
    expect(decision?.selectedDocumentId).toContain("2025");
    expect(decision?.alternativeDocumentIds.some((id) => id.includes("2023"))).toBe(
      true,
    );
  });

  it("marks marketing as non-binding selected role", async () => {
    const manifest = await loadDocumentRelationsManifest();
    const decision = resolveVersionDecisions(
      manifest,
      extractUserTemporalFacts(["יש רכב חלופי בלי כוכביות?"]),
      FAMILY_IDS,
    ).find((d) => d.documentFamily === "car_marketing");
    expect(decision?.reasonCode).toBe("marketing_non_binding");
  });
});
