import { describe, expect, it } from "vitest";
import { buildIndexFromVectors } from "./build-index";
import type { Chunk } from "../chunking/types";
import { retrieve } from "./retrieve";
import {
  DEFAULT_EMBEDDING_DIMENSIONS,
  DEFAULT_EMBEDDING_MODEL,
} from "./types";

function chunk(id: string, title: string, body: string): Chunk {
  return {
    chunkId: id,
    text: `מסמך: ${title}\nסעיף: ${title}\n\n${body}`,
    metadata: {
      documentId: id.replace(/:c.*/, ""),
      relativePath: `${id.replace(/:c.*/, "")}.md`,
      sourceHash: "x",
      documentTitle: title,
      sectionPath: [title],
      sourceBlockIds: [`${id}:b0`],
      warnings: [],
      charCount: body.length,
      tokenEstimate: 10,
      tokenEstimateMethod: "heuristic_he_en_v1_max(words*1.3, chars/2.8)",
    },
  };
}

describe("retrieve modes (offline)", () => {
  const chunks = [
    chunk("doc/towing:c000", "כתב שירות גרירה", "עד 4 גרירות בשנת ביטוח"),
    chunk("doc/cash:c000", "ביטוח תכולה", "פריט מזומנים גבול 2000"),
    chunk("doc/other:c000", "תנאים כלליים", "התיישנות שלוש שנים"),
  ];
  // Distinct unit vectors in first 3 dims; rest zeros — cosine = exact axis match.
  const embeddings = [
    [1, 0, 0, ...Array(DEFAULT_EMBEDDING_DIMENSIONS - 3).fill(0)],
    [0, 1, 0, ...Array(DEFAULT_EMBEDDING_DIMENSIONS - 3).fill(0)],
    [0, 0, 1, ...Array(DEFAULT_EMBEDDING_DIMENSIONS - 3).fill(0)],
  ];
  const index = buildIndexFromVectors(chunks, embeddings, {
    model: DEFAULT_EMBEDDING_MODEL,
    dimensions: DEFAULT_EMBEDDING_DIMENSIONS,
  });

  it("falls back to semantic ranking when BM25 has no overlap", async () => {
    const queryEmbedding = embeddings[2]!;
    const result = await retrieve(
      "zzzz-no-overlap-token",
      { mode: "hybrid", topK: 2, queryEmbedding },
      { index },
    );
    expect(result.lexicalFallbackToSemantic).toBe(true);
    expect(result.hits[0]!.chunkId).toBe("doc/other:c000");
    expect(result.hits[0]!.semanticRank).toBe(1);
  });

  it("hybrid can surface a strong lexical match over a weak semantic neighbor", async () => {
    // Query embedding closest to "other", but question text matches towing lexically.
    const queryEmbedding = embeddings[2]!;
    const result = await retrieve(
      "כמה גרירות מקבלים",
      { mode: "hybrid", topK: 3, queryEmbedding },
      { index },
    );
    expect(result.lexicalFallbackToSemantic).toBe(false);
    expect(result.hits.some((h) => h.chunkId === "doc/towing:c000")).toBe(true);
    const towing = result.hits.find((h) => h.chunkId === "doc/towing:c000")!;
    expect(towing.lexicalRank).toBeDefined();
    expect(towing.fusionScore).toBeDefined();
  });
});
