import { describe, expect, it } from "vitest";
import {
  countPolicyIssueAnchors,
  isMultiScenarioPolicyComparison,
} from "./multi-scenario";
import { extractUserTemporalFacts } from "./dates";
import { resolveVersionDecisions } from "./resolve";
import type { DocumentRelationsManifest } from "./types";

const MINI_MANIFEST = {
  manifestVersion: 1 as const,
  documents: [
    {
      documentId: "corpus/01_car_comprehensive_policy_2024",
      documentFamily: "car_comprehensive_policy",
      versionLabel: "2024",
      documentRole: "policy" as const,
      evidence: [
        { chunkIds: ["corpus/01_car_comprehensive_policy_2024:c000"] },
      ],
    },
    {
      documentId: "corpus/02_car_comprehensive_policy_2026",
      documentFamily: "car_comprehensive_policy",
      versionLabel: "2026",
      documentRole: "policy" as const,
      evidence: [
        { chunkIds: ["corpus/02_car_comprehensive_policy_2026:c000"] },
      ],
    },
  ],
  relationships: [],
} as unknown as DocumentRelationsManifest;

describe("isMultiScenarioPolicyComparison", () => {
  it("detects three-case comparison", () => {
    const q =
      "מה ההשתתפות בכל אחד מהמקרים: פוליסה שהונפקה ב-28.2.2026 ולא חודשה; פוליסה שהונפקה ב-1.3.2026; פוליסה שהונפקה ב-2024 וחודשה ב-1.4.2026?";
    expect(countPolicyIssueAnchors(q)).toBeGreaterThanOrEqual(3);
    expect(isMultiScenarioPolicyComparison([q])).toBe(true);
  });

  it("does not treat single issue+renewal as multi-scenario", () => {
    const q = "פוליסה שהונפקה ב-2024 וחודשה ב-1.4.2026 — מה ההשתתפות במוסך הסדר?";
    expect(countPolicyIssueAnchors(q)).toBe(1);
    expect(isMultiScenarioPolicyComparison([q])).toBe(false);
  });

  it("does not treat event-only accident date as multi-scenario", () => {
    const q = "אירעה תאונה באפריל 2026 — מה ההשתתפות במקיף?";
    expect(isMultiScenarioPolicyComparison([q])).toBe(false);
  });

  it("does not double-count the same scenario across original + standalone", () => {
    const q =
      "פוליסה שהונפקה ב-1.1.2024 וחודשה ב-1.4.2026: מה ההשתתפות העצמית במוסך הסדר?";
    expect(isMultiScenarioPolicyComparison([q, q])).toBe(false);
  });

  it("does not treat a correction restatement as two scenarios", () => {
    const trimmed = "טעיתי: הפוליסה הונפקה בפברואר 2026 ולא חודשה מאז.";
    const standalone =
      "מה סכום ההשתתפות העצמית במוסך הסדר בפוליסת ביטוח רכב מקיף שהונפקה בפברואר 2026 ולא חודשה מאז?";
    expect(isMultiScenarioPolicyComparison([trimmed, standalone])).toBe(false);
  });
});

describe("resolveVersionDecisions multi-scenario", () => {
  const present = new Set([
    "corpus/01_car_comprehensive_policy_2024",
    "corpus/02_car_comprehensive_policy_2026",
  ]);

  it("keeps both versions unresolved for comparison (no demotion path)", () => {
    const q =
      "בכל אחד מהמקרים: שהונפקה ב-28.2.2026; שהונפקה ב-1.3.2026; שהונפקה ב-2024 וחודשה ב-1.4.2026";
    const facts = extractUserTemporalFacts([q]);
    const decisions = resolveVersionDecisions(
      MINI_MANIFEST,
      facts,
      present,
      [q],
    );
    const car = decisions.find((d) => d.documentFamily === "car_comprehensive_policy");
    expect(car?.status).toBe("unresolved");
    expect(car?.reasonCode).toBe("multi_scenario_comparison_keep_versions");
    expect(car?.alternativeDocumentIds).toContain(
      "corpus/01_car_comprehensive_policy_2024",
    );
    expect(car?.alternativeDocumentIds).toContain(
      "corpus/02_car_comprehensive_policy_2026",
    );
  });

  it("still selects 2026 for single renewed policy", () => {
    const q = "פוליסה שהונפקה ב-1.1.2024 וחודשה ב-1.4.2026 מה ההשתתפות במוסך הסדר?";
    const facts = extractUserTemporalFacts([q]);
    const decisions = resolveVersionDecisions(
      MINI_MANIFEST,
      facts,
      present,
      [q],
    );
    const car = decisions.find((d) => d.documentFamily === "car_comprehensive_policy");
    expect(car?.status).toBe("selected");
    expect(car?.selectedDocumentId).toBe(
      "corpus/02_car_comprehensive_policy_2026",
    );
  });
});
