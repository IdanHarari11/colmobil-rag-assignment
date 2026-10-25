import { describe, expect, it } from "vitest";
import type { RetrievalHit } from "../rag/types";
import {
  documentRecallAtK,
  mean,
  reciprocalRank,
} from "./retrieval-metrics";

function hit(relativePath: string, chunkId = relativePath): RetrievalHit {
  return {
    chunkId,
    documentId: `corpus/${relativePath.replace(/\.[^.]+$/, "")}`,
    relativePath: `corpus/${relativePath}`,
    text: "x",
    warnings: [],
    score: 0.5,
  };
}

describe("retrieval metrics", () => {
  it("computes document recall@k without double-counting the same document", () => {
    const hits = [
      hit("02_car_comprehensive_policy_2026.pdf", "a"),
      hit("02_car_comprehensive_policy_2026.pdf", "b"),
      hit("10_home_policy_overview.md", "c"),
    ];
    const refs = [
      "02_car_comprehensive_policy_2026.pdf",
      "10_home_policy_overview.md",
    ];
    expect(documentRecallAtK(hits, refs, 1)).toBeCloseTo(0.5);
    expect(documentRecallAtK(hits, refs, 3)).toBeCloseTo(1);
  });

  it("returns N/A inputs as null when there are no reference sources", () => {
    expect(documentRecallAtK([hit("a.md")], [], 5)).toBeNull();
    expect(reciprocalRank([hit("a.md")], [])).toBeNull();
  });

  it("computes reciprocal rank of the first reference document hit", () => {
    const hits = [hit("other.md"), hit("28_call_center_hours.md")];
    expect(reciprocalRank(hits, ["28_call_center_hours.md"])).toBeCloseTo(0.5);
    expect(mean([1, 0.5])).toBeCloseTo(0.75);
  });
});
