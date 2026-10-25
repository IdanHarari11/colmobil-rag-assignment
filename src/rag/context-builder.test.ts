import { describe, expect, it } from "vitest";
import type { Chunk } from "../chunking/types";
import { buildIndexFromVectors } from "./build-index";
import {
  buildGenerationContext,
  DEFAULT_CONTEXT_BUDGET_TOKENS,
} from "./context-builder";
import type { RetrievalHit } from "./types";
import {
  DEFAULT_EMBEDDING_DIMENSIONS,
  DEFAULT_EMBEDDING_MODEL,
} from "./types";

function makeChunk(id: string, docId: string, body: string): Chunk {
  return {
    chunkId: id,
    text: body,
    metadata: {
      documentId: docId,
      relativePath: `${docId}.md`,
      sourceHash: "h",
      documentTitle: docId,
      sectionPath: [docId, id],
      sourceBlockIds: [`${id}:b`],
      warnings: [],
      charCount: body.length,
      tokenEstimate: 10,
      tokenEstimateMethod: "heuristic_he_en_v1_max(words*1.3, chars/2.8)",
    },
  };
}

function hit(chunkId: string, documentId: string, text: string): RetrievalHit {
  return {
    chunkId,
    documentId,
    relativePath: `${documentId}.md`,
    text,
    documentTitle: documentId,
    sectionPath: [documentId],
    warnings: [],
    score: 0.5,
  };
}

describe("buildGenerationContext", () => {
  const chunks = [
    makeChunk("docA:c000", "docA", "A0 definition of authorized driver"),
    makeChunk("docA:c001", "docA", "A1 exception clause referring to definition"),
    makeChunk("docA:c002", "docA", "A2 unrelated intro"),
    makeChunk("docB:c000", "docB", "B0 young driver annex"),
  ];
  const embeddings = chunks.map((_, i) => {
    const v = Array(DEFAULT_EMBEDDING_DIMENSIONS).fill(0);
    v[i] = 1;
    return v;
  });
  const index = buildIndexFromVectors(chunks, embeddings, {
    model: DEFAULT_EMBEDDING_MODEL,
    dimensions: DEFAULT_EMBEDDING_DIMENSIONS,
  });

  it("keeps retrieved hits and expands same-document siblings without duplicates", () => {
    const retrieved = [
      hit("docA:c000", "docA", chunks[0]!.text),
      hit("docB:c000", "docB", chunks[3]!.text),
    ];
    const result = buildGenerationContext(retrieved, index);
    const ids = result.contextChunks.map((c) => c.chunkId);
    expect(ids[0]).toBe("docA:c000");
    expect(ids[1]).toBe("docB:c000");
    expect(ids).toContain("docA:c001");
    expect(ids).toContain("docA:c002");
    expect(new Set(ids).size).toBe(ids.length);
    expect(
      result.contextChunks.find((c) => c.chunkId === "docA:c001")?.origin,
    ).toBe("expanded");
    expect(
      result.contextChunks.find((c) => c.chunkId === "docA:c000")?.origin,
    ).toBe("retrieved");
  });

  it("does not drop other-doc retrieved evidence to fit expansions", () => {
    const retrieved = [
      hit("docA:c000", "docA", chunks[0]!.text),
      hit("docB:c000", "docB", chunks[3]!.text),
    ];
    // Tight budget: both short retrieved hits fit; sibling expansions may not.
    const result = buildGenerationContext(retrieved, index, {
      budgetTokens: 120,
    });
    expect(
      result.contextChunks.map((c) => `${c.chunkId}:${c.origin}`),
    ).toEqual(
      expect.arrayContaining([
        "docA:c000:retrieved",
        "docB:c000:retrieved",
      ]),
    );
    expect(result.budgetTokens).toBeLessThan(DEFAULT_CONTEXT_BUDGET_TOKENS);
  });

  it("never truncates a chunk to fit the budget", () => {
    const huge = "word ".repeat(5000);
    const retrieved = [hit("docA:c000", "docA", huge)];
    const result = buildGenerationContext(retrieved, index, { budgetTokens: 50 });
    expect(result.omittedRetrieved[0]?.reason).toMatch(/Whole chunk kept out/);
    // Oversized retrieved id must not reappear truncated or via expansion.
    expect(result.contextChunks.every((c) => c.chunkId !== "docA:c000")).toBe(
      true,
    );
    for (const chunk of result.contextChunks) {
      expect(chunk.text).toBe(
        index.items.find((i) => i.chunkId === chunk.chunkId)?.chunk.text,
      );
    }
  });
});
