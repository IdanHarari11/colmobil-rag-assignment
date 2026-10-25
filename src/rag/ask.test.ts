import { describe, expect, it } from "vitest";
import type { Chunk } from "../chunking/types";
import { ask } from "./ask";
import type { GenerateAnswerResult } from "./generate";
import { buildIndexFromVectors } from "./build-index";
import {
  DEFAULT_EMBEDDING_DIMENSIONS,
  DEFAULT_EMBEDDING_MODEL,
} from "./types";
import {
  GenerationSystemError,
  NEUTRAL_INSUFFICIENT_ANSWER,
} from "./ask-types";
import { MemoryTraceWriter } from "./trace";
import type { DocumentRelationsManifest } from "./document-relations";

const EMPTY_MANIFEST: DocumentRelationsManifest = {
  manifestVersion: 1,
  documents: [],
};

function makeChunk(id: string, docId: string, body: string): Chunk {
  return {
    chunkId: id,
    text: body,
    metadata: {
      documentId: docId,
      relativePath: `${docId}.md`,
      sourceHash: "h",
      documentTitle: docId,
      sectionPath: [docId],
      sourceBlockIds: [`${id}:b`],
      warnings: [],
      charCount: body.length,
      tokenEstimate: 10,
      tokenEstimateMethod: "heuristic_he_en_v1_max(words*1.3, chars/2.8)",
    },
  };
}

describe("ask()", () => {
  const chunks = [
    makeChunk("docA:c000", "docA", "שעות המוקד א עד ה שמונה עד חמש"),
    makeChunk("docB:c000", "docB", "ביטול פוליסה תוך 14 יום"),
  ];
  const embeddings = chunks.map((_, i) => {
    const v = Array(DEFAULT_EMBEDDING_DIMENSIONS).fill(0);
    v[0] = 1;
    v[i + 1] = 0.5;
    return v;
  });
  const index = buildIndexFromVectors(chunks, embeddings, {
    model: DEFAULT_EMBEDDING_MODEL,
    dimensions: DEFAULT_EMBEDDING_DIMENSIONS,
  });

  const embedderConfig = {
    model: DEFAULT_EMBEDDING_MODEL,
    dimensions: DEFAULT_EMBEDDING_DIMENSIONS,
  };
  const embedder = {
    config: embedderConfig,
    async embedTexts(texts: string[]) {
      return {
        embeddings: texts.map(() => {
          const v = Array(DEFAULT_EMBEDDING_DIMENSIONS).fill(0);
          v[0] = 1;
          return v;
        }),
        usage: { promptTokens: 1, totalTokens: 1 },
        config: embedderConfig,
      };
    },
  };

  it("assembles answer from parts after retrieve (no pre-retrieve clarify)", async () => {
    const generateOk = async (): Promise<GenerateAnswerResult> => ({
      payload: {
        status: "answered",
        answerParts: [
          { text: "שעות המוקד הן א׳–ה׳.", sourceChunkIds: ["docA:c000"] },
        ],
      },
      rawText: "{}",
      model: "mock-model",
      modelRequested: "mock-model",
      modelReturned: "mock-model",
      samplingProfile: { kind: "classic_sampling", temperature: 0 },
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      latencyMs: 1,
    });

    const writer = new MemoryTraceWriter();
    const result = await ask(
      "מה שעות המוקד?",
      { mode: "hybrid", topK: 2, answerReviewEnabled: false, traceWriter: writer, traceSource: "test" },
      { index, embedder, generate: generateOk, documentRelationsManifest: EMPTY_MANIFEST },
    );
    expect(result.status).toBe("answered");
    expect(result.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(result.retrievedChunks.length).toBeGreaterThan(0);
    expect(result.answer).toBe("שעות המוקד הן א׳–ה׳.");
    expect(result.answerParts).toHaveLength(1);
    expect(result.sources[0]?.fileName).toBe("docA.md");
    expect(result.timingsMs).not.toHaveProperty("clarifyMs");
    const rewriteStage = writer.events.find(
      (e) => e.type === "stage" && e.payload.stage === "rewrite",
    );
    expect(rewriteStage?.type === "stage" && rewriteStage.payload.status).toBe(
      "skipped",
    );
    const end = writer.events.find((e) => e.type === "end");
    expect(end?.type === "end" && end.payload.outcome).toBe("success");
  });

  it("rejects forged citation ids from answerParts", async () => {
    const generateBad = async (): Promise<GenerateAnswerResult> => ({
      payload: {
        status: "answered",
        answerParts: [
          { text: "טענה", sourceChunkIds: ["missing:c999"] },
        ],
      },
      rawText: "{}",
      model: "mock-model",
      modelRequested: "mock-model",
      modelReturned: "mock-model",
      samplingProfile: { kind: "classic_sampling", temperature: 0 },
      latencyMs: 1,
    });

    await expect(
      ask(
        "שאלה",
        { mode: "lexical", topK: 2, answerReviewEnabled: false },
        { index, embedder, generate: generateBad, documentRelationsManifest: EMPTY_MANIFEST },
      ),
    ).rejects.toBeInstanceOf(GenerationSystemError);
  });

  it("returns neutral insufficient_evidence copy", async () => {
    const generate = async (): Promise<GenerateAnswerResult> => ({
      payload: { status: "insufficient_evidence", answerParts: [] },
      rawText: "{}",
      model: "mock-model",
      modelRequested: "mock-model",
      modelReturned: "mock-model",
      samplingProfile: { kind: "classic_sampling", temperature: 0 },
      latencyMs: 1,
    });

    const result = await ask(
      "האם יש ביטוח רחפנים?",
      { mode: "lexical", topK: 2, answerReviewEnabled: false },
      { index, embedder, generate , documentRelationsManifest: EMPTY_MANIFEST },
    );
    expect(result.status).toBe("insufficient_evidence");
    expect(result.answer).toBe(NEUTRAL_INSUFFICIENT_ANSWER);
    expect(result.citations).toEqual([]);
  });

  it("passes through clarification_needed from generation without sources", async () => {
    const generate = async (): Promise<GenerateAnswerResult> => ({
      payload: {
        status: "clarification_needed",
        answerParts: [
          { text: "לאיזה מוצר הכוונה?", sourceChunkIds: [] },
        ],
      },
      rawText: "{}",
      model: "mock-model",
      modelRequested: "mock-model",
      modelReturned: "mock-model",
      samplingProfile: { kind: "classic_sampling", temperature: 0 },
      latencyMs: 1,
    });

    const result = await ask(
      "מה ההשתתפות העצמית?",
      { mode: "hybrid", topK: 2, answerReviewEnabled: false },
      { index, embedder, generate , documentRelationsManifest: EMPTY_MANIFEST },
    );
    expect(result.status).toBe("clarification_needed");
    expect(result.answer).toBe("לאיזה מוצר הכוונה?");
    expect(result.citations).toEqual([]);
    expect(result.retrievedChunks.length).toBeGreaterThan(0);
    expect(result.standaloneQuestion).toBe("מה ההשתתפות העצמית?");
    expect(result.rewrite).toBeUndefined();
  });

  it("without history skips rewrite and retrieves the original question", async () => {
    const rewrite = async () => {
      throw new Error("rewrite must not run without history");
    };
    const generateOk = async (): Promise<GenerateAnswerResult> => ({
      payload: {
        status: "answered",
        answerParts: [
          { text: "שעות.", sourceChunkIds: ["docA:c000"] },
        ],
      },
      rawText: "{}",
      model: "mock-model",
      modelRequested: "mock-model",
      modelReturned: "mock-model",
      samplingProfile: { kind: "classic_sampling", temperature: 0 },
      latencyMs: 1,
    });
    const result = await ask(
      "מה שעות המוקד?",
      { mode: "hybrid", topK: 2, history: [], answerReviewEnabled: false },
      { index, embedder, generate: generateOk, rewrite, documentRelationsManifest: EMPTY_MANIFEST },
    );
    expect(result.rewrite).toBeUndefined();
    expect(result.standaloneQuestion).toBe("מה שעות המוקד?");
  });

  it("with history rewrites then retrieves standaloneQuestion", async () => {
    const retrievedQueries: string[] = [];
    const rewrite = async () => ({
      standaloneQuestion:
        "מה ההשתתפות העצמית במוסך שאינו בהסדר לפוליסת רכב מקיף מ-1.3.2026?",
      unresolvedReferences: [] as string[],
      model: "mock-rewrite",
      modelRequested: "mock-model",
      modelReturned: "mock-model",
      samplingProfile: { kind: "classic_sampling", temperature: 0 },
      usage: { promptTokens: 11, completionTokens: 7, totalTokens: 18 },
      latencyMs: 12,
    });
    const generate = async (opts: {
      question: string;
      standaloneQuestion?: string;
      unresolvedReferences?: readonly string[];
    }): Promise<GenerateAnswerResult> => {
      expect(opts.question).toBe("ומה במוסך שאינו בהסדר?");
      expect(opts.standaloneQuestion).toContain("רכב מקיף");
      expect(opts.unresolvedReferences).toEqual([]);
      return {
        payload: {
          status: "clarification_needed",
          answerParts: [
            { text: "נא לאשר סוג מוסך.", sourceChunkIds: [] },
          ],
        },
        rawText: "{}",
        model: "mock-model",
      modelRequested: "mock-model",
      modelReturned: "mock-model",
      samplingProfile: { kind: "classic_sampling", temperature: 0 },
        latencyMs: 1,
      };
    };

    const result = await ask(
      "ומה במוסך שאינו בהסדר?",
      {
        mode: "lexical",
        topK: 2,
        answerReviewEnabled: false,
        history: [
          {
            role: "user",
            content: "יש לי רכב מקיף שהונפק ב-1.3.2026. מה ההשתתפות במוסך הסדר?",
          },
          { role: "assistant", content: "במוסך הסדר ההשתתפות היא 1,100 ₪." },
        ],
      },
      {
        index,
        embedder,
        generate,
        documentRelationsManifest: EMPTY_MANIFEST,
        rewrite: async (opts) => {
          retrievedQueries.push(opts.question);
          return rewrite();
        },
      },
    );

    expect(retrievedQueries).toEqual(["ומה במוסך שאינו בהסדר?"]);
    expect(result.standaloneQuestion).toContain("רכב מקיף");
    expect(result.rewrite?.standaloneQuestion).toContain("רכב מקיף");
    expect(result.usage?.rewritePromptTokens).toBe(11);
    expect(result.timingsMs.rewriteMs).toBe(12);
    expect(result.status).toBe("clarification_needed");
  });

  it("surfaces rewrite failure without silent fallback", async () => {
    const { RewriteSystemError } = await import("./rewrite-query");
    await expect(
      ask(
        "ומה עם זה?",
        {
          mode: "lexical",
          topK: 1,
          answerReviewEnabled: false,
          history: [{ role: "user", content: "שאלה קודמת על רכב" }],
        },
        {
          index,
          embedder,
          documentRelationsManifest: EMPTY_MANIFEST,
          rewrite: async () => {
            throw new RewriteSystemError("Rewrite API error: boom");
          },
        },
      ),
    ).rejects.toBeInstanceOf(GenerationSystemError);
  });
});
