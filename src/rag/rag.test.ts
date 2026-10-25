import { describe, expect, it } from "vitest";
import type { Chunk } from "../chunking/types";
import { buildIndexFromVectors } from "./build-index";
import { cosineSimilarity, rankByCosine } from "./cosine";
import { buildEmbeddingText } from "./embedding-text";
import { assertIndexCompatible } from "./index-store";
import {
  DEFAULT_EMBEDDING_DIMENSIONS,
  DEFAULT_EMBEDDING_MODEL,
  IndexMismatchError,
} from "./types";

function makeChunk(overrides: Partial<Chunk> & { chunkId: string; text: string }): Chunk {
  return {
    chunkId: overrides.chunkId,
    text: overrides.text,
    metadata: {
      documentId: overrides.metadata?.documentId ?? "corpus/demo",
      relativePath: overrides.metadata?.relativePath ?? "corpus/demo.md",
      sourceHash: overrides.metadata?.sourceHash ?? "hash",
      documentTitle: overrides.metadata?.documentTitle ?? "כותרת דמו",
      sectionPath: overrides.metadata?.sectionPath ?? ["כותרת דמו", "סעיף א"],
      sourceBlockIds: overrides.metadata?.sourceBlockIds ?? ["corpus/demo:b001"],
      warnings: overrides.metadata?.warnings ?? ["Table structure inferred"],
      charCount: overrides.text.length,
      tokenEstimate: 10,
      tokenEstimateMethod: "heuristic_he_en_v1_max(words*1.3, chars/2.8)",
      ...overrides.metadata,
    },
  };
}

describe("cosine similarity and ranking", () => {
  it("returns 1 for identical vectors and orders known vectors", () => {
    const a = [1, 0, 0];
    const b = [1, 0, 0];
    const c = [0, 1, 0];
    const d = [-1, 0, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 8);
    expect(cosineSimilarity(a, c)).toBeCloseTo(0, 8);
    expect(cosineSimilarity(a, d)).toBeCloseTo(-1, 8);

    const ranked = rankByCosine(a, [
      { embedding: c, chunkId: "c" },
      { embedding: b, chunkId: "b" },
      { embedding: d, chunkId: "d" },
    ]);
    expect(ranked.map((item) => item.chunkId)).toEqual(["b", "c", "d"]);
    expect(ranked[0]!.score).toBeCloseTo(1, 8);
  });
});

describe("embedding text", () => {
  it("includes titles and body but not technical ids or warnings", () => {
    const chunk = makeChunk({
      chunkId: "corpus/demo:c000",
      text: [
        "מסמך: כותרת דמו",
        "סעיף: כותרת דמו > סעיף א",
        "תחולת מקור: בתוקף מ-2026",
        "",
        "תוכן מהותי על טופס 4401",
      ].join("\n"),
      metadata: {
        documentId: "corpus/demo",
        relativePath: "corpus/demo.md",
        sourceHash: "abc",
        documentTitle: "כותרת דמו",
        sectionPath: ["כותרת דמו", "סעיף א"],
        sourceBlockIds: ["corpus/demo:b001"],
        warnings: ["do-not-embed-this-warning"],
        charCount: 1,
        tokenEstimate: 1,
        tokenEstimateMethod: "heuristic_he_en_v1_max(words*1.3, chars/2.8)",
      },
    });

    const text = buildEmbeddingText(chunk);
    expect(text).toMatch(/כותרת דמו/);
    expect(text).toMatch(/סעיף א/);
    expect(text).toMatch(/בתוקף מ-2026/);
    expect(text).toMatch(/4401/);
    expect(text).not.toMatch(/corpus\/demo:c000/);
    expect(text).not.toMatch(/do-not-embed-this-warning/);
    expect(text).not.toMatch(/sourceHash|sourceBlockIds/);
  });
});

describe("index compatibility", () => {
  it("detects model/hash mismatch and asks to rebuild", () => {
    const chunks = [
      makeChunk({ chunkId: "a:c000", text: "hello world content" }),
      makeChunk({ chunkId: "b:c000", text: "other content here" }),
    ];
    const dims = 4;
    const index = buildIndexFromVectors(
      chunks,
      [
        [1, 0, 0, 0],
        [0, 1, 0, 0],
      ],
      { model: DEFAULT_EMBEDDING_MODEL, dimensions: dims },
    );

    expect(() =>
      assertIndexCompatible({
        index,
        chunks,
        config: { model: DEFAULT_EMBEDDING_MODEL, dimensions: dims },
      }),
    ).not.toThrow();

    expect(() =>
      assertIndexCompatible({
        index,
        chunks,
        config: { model: "other-model", dimensions: dims },
      }),
    ).toThrow(IndexMismatchError);

    const mutated = structuredClone(chunks);
    mutated[0]!.text = "changed body";
    expect(() =>
      assertIndexCompatible({
        index,
        chunks: mutated,
        config: { model: DEFAULT_EMBEDDING_MODEL, dimensions: dims },
      }),
    ).toThrow(/Rebuild with: pnpm index/);
  });

  it("defaults match text-embedding-3-small / 1536", () => {
    expect(DEFAULT_EMBEDDING_MODEL).toBe("text-embedding-3-small");
    expect(DEFAULT_EMBEDDING_DIMENSIONS).toBe(1536);
  });
});
