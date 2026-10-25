import { describe, expect, it } from "vitest";
import {
  assessEvidenceCoverage,
} from "./run-extended-ask-eval";
import {
  loadExtendedEvalSet,
  sha256Hex,
  toDevQuestions,
} from "./load-extended-set";

describe("extended eval set freeze", () => {
  it("loads 20 questions and matches frozen sha256", async () => {
    const { set, contentSha256, hashMatched } = await loadExtendedEvalSet();
    expect(set.questions).toHaveLength(20);
    expect(hashMatched).toBe(true);
    expect(contentSha256).toMatch(/^[a-f0-9]{64}$/);
    const cats = new Set(set.questions.map((q) => q.category));
    expect(cats.has("factual")).toBe(true);
    expect(cats.has("no_answer")).toBe(true);
    expect(cats.has("cross_lingual")).toBe(true);
    const asDev = toDevQuestions(set.questions);
    expect(asDev[0]?.reference_answer.length).toBeGreaterThan(0);
  });

  it("sha256Hex is stable", () => {
    expect(sha256Hex("abc")).toBe(sha256Hex("abc"));
    expect(sha256Hex("abc")).not.toBe(sha256Hex("abd"));
  });
});

describe("assessEvidenceCoverage", () => {
  it("marks N/A when no sources required", () => {
    const r = assessEvidenceCoverage(
      {
        id: "E16",
        category: "ambiguous",
        question: "x",
        expectedBehavior: "clarification_needed",
        materialFacts: [],
        evidence: [],
        acceptableSourceAlternatives: [],
        reference_answer: "y",
        forbiddenAssumptions: [],
        sources: [],
      },
      ["corpus/x:c000"],
      ["x.md"],
    );
    expect(r.coverage).toBe("n_a");
  });

  it("detects full chunk coverage", () => {
    const r = assessEvidenceCoverage(
      {
        id: "E01",
        category: "factual",
        question: "x",
        expectedBehavior: "answered",
        materialFacts: [],
        evidence: [
          {
            fileName: "31_ofek_plus_vip.docx",
            chunkId: "corpus/31_ofek_plus_vip:c000",
            quoteSnippet: "3",
          },
        ],
        acceptableSourceAlternatives: [],
        reference_answer: "y",
        forbiddenAssumptions: [],
        sources: ["31_ofek_plus_vip.docx"],
      },
      ["corpus/31_ofek_plus_vip:c000"],
      ["corpus/31_ofek_plus_vip.docx"],
    );
    expect(r.coverage).toBe("full");
  });
});
