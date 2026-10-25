import { describe, expect, it } from "vitest";
import { buildBm25Index } from "./bm25";
import { tokenizeForBm25 } from "./tokenize";
import { fuseRrf } from "./rrf";

describe("BM25 tokenizer", () => {
  it("normalizes case and keeps Hebrew digits separately from punctuation", () => {
    expect(tokenizeForBm25("גרירה 4x")).toEqual(["גרירה", "4x"]);
    expect(tokenizeForBm25("Hello World")).toEqual(["hello", "world"]);
    expect(tokenizeForBm25("1,100 ₪")).toEqual(["1", "100"]);
  });

  it("treats גררה morphology variants as different tokens (no stemming)", () => {
    expect(tokenizeForBm25("גרירה")).not.toEqual(tokenizeForBm25("גרירות"));
  });
});

describe("BM25 ranking", () => {
  it("ranks the document with the rare matching term highest", () => {
    const index = buildBm25Index([
      { id: "a", text: "ביטוח רכב מקיף עם השתתפות עצמית" },
      { id: "b", text: "כתב שירות גרירה ושירותי דרך עד 4 גרירות" },
      { id: "c", text: "ביטוח תכולה מזומנים עד 2000" },
    ]);
    const hits = index.search("כמה גרירות בשנת ביטוח");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.id).toBe("b");
    expect(hits[0]!.score).toBeGreaterThan(0);
    expect(hits.every((h) => h.score > 0)).toBe(true);
  });

  it("returns no hits when there is no lexical overlap", () => {
    const index = buildBm25Index([
      { id: "a", text: "hello world" },
      { id: "b", text: "foo bar" },
    ]);
    expect(index.search("zzzzqqq")).toEqual([]);
  });
});

describe("RRF fusion", () => {
  it("combines ranks with 1/(c+rank) and stable tie-break", () => {
    const fused = fuseRrf(
      [
        { id: "a", rank: 1, score: 0.9 },
        { id: "b", rank: 2, score: 0.8 },
      ],
      [
        { id: "b", rank: 1, score: 5 },
        { id: "c", rank: 2, score: 3 },
      ],
      { c: 60 },
    );
    expect(fused[0]!.id).toBe("b");
    // semantic rank 2 + lexical rank 1
    expect(fused[0]!.fusionScore).toBeCloseTo(1 / 62 + 1 / 61, 10);
    expect(fused[0]!.semanticRank).toBe(2);
    expect(fused[0]!.lexicalRank).toBe(1);
    expect(fused.find((h) => h.id === "a")!.lexicalRank).toBeUndefined();
  });

  it("keeps semantic-only candidates when lexical list is empty (caller decision)", () => {
    const fused = fuseRrf(
      [{ id: "a", rank: 1, score: 0.5 }],
      [],
      { c: 60 },
    );
    expect(fused).toHaveLength(1);
    expect(fused[0]!.fusionScore).toBeCloseTo(1 / 61, 10);
  });
});
