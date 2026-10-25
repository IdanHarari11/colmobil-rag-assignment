import { describe, expect, it } from "vitest";
import {
  ASK_MAX_QUESTION_CHARS,
  isAskDisplayResponse,
  toAskDisplayResponse,
} from "./ask-display";
import type { AskResult, ContextChunk } from "@/rag/ask-types";
import { NEUTRAL_INSUFFICIENT_ANSWER } from "@/rag/ask-types";

function chunk(
  overrides: Partial<ContextChunk> & Pick<ContextChunk, "chunkId" | "text">,
): ContextChunk {
  return {
    documentId: "doc",
    relativePath: "doc.md",
    warnings: [],
    origin: "retrieved",
    estimatedTokens: 10,
    ...overrides,
  };
}

function baseResult(overrides: Partial<AskResult> = {}): AskResult {
  return {
    requestId: "test-request-id",
    question: "שאלה",
    standaloneQuestion: "שאלה",
    unresolvedReferences: [],
    status: "answered",
    answer: "תשובה.",
    answerParts: [{ text: "תשובה.", sourceChunkIds: ["doc:c000"] }],
    citations: [{ chunkId: "doc:c000", claims: ["תשובה."] }],
    sources: [
      {
        chunkId: "doc:c000",
        documentId: "doc",
        relativePath: "doc.md",
        fileName: "doc.md",
        documentTitle: "מסמך",
        sectionPath: ["סעיף א"],
        pages: [2],
        claims: ["תשובה."],
        origin: "retrieved",
      },
    ],
    retrievedChunks: [],
    contextChunks: [
      chunk({
        chunkId: "doc:c000",
        documentTitle: "מסמך",
        sectionPath: ["סעיף א"],
        pages: [2],
        text: "טקסט מהאינדקס",
      }),
      chunk({
        chunkId: "doc:c001",
        text: "קטע שנשלף אך לא צוטט",
        origin: "expanded",
      }),
    ],
    contextMeta: {
      budgetTokens: 3500,
      estimatedContextTokens: 20,
      tokenEstimateMethod: "heuristic",
      contextComplete: true,
      omittedRetrieved: [],
      omittedExpansions: [],
    },
    validation: {
      structureOk: true,
      citationsOk: true,
      invalidCitationIds: [],
    },
    retrievalMode: "hybrid",
    generationModel: "gpt-4.1-mini",
    embeddingModel: "text-embedding-3-small",
    usage: {
      embeddingPromptTokens: 1,
      generationPromptTokens: 1,
      generationCompletionTokens: 1,
      generationTotalTokens: 2,
    },
    timingsMs: {
      retrieveMs: 1,
      contextMs: 1,
      generationMs: 1,
      totalMs: 3,
    },
    ...overrides,
  };
}

describe("toAskDisplayResponse", () => {
  it("maps answered payload with cited source text from index", () => {
    const display = toAskDisplayResponse(baseResult());
    expect(display.requestId).toBe("test-request-id");
    expect(display.status).toBe("answered");
    expect(display.answerParts).toHaveLength(1);
    expect(display.sources).toHaveLength(1);
    expect(display.sources[0]?.text).toBe("טקסט מהאינדקס");
    expect(display.sources.map((s) => s.chunkId)).not.toContain("doc:c001");
    expect(display).not.toHaveProperty("retrievedChunks");
    expect(display).not.toHaveProperty("contextChunks");
  });

  it("maps clarification_needed without inventing sources", () => {
    const display = toAskDisplayResponse(
      baseResult({
        status: "clarification_needed",
        answer: "נא לציין לאיזה מוצר.",
        answerParts: [{ text: "נא לציין לאיזה מוצר.", sourceChunkIds: [] }],
        citations: [],
        sources: [],
      }),
    );
    expect(display.status).toBe("clarification_needed");
    expect(display.sources).toEqual([]);
    expect(display.answerParts[0]?.sourceChunkIds).toEqual([]);
  });

  it("maps insufficient_evidence with empty sources", () => {
    const display = toAskDisplayResponse(
      baseResult({
        status: "insufficient_evidence",
        answer: NEUTRAL_INSUFFICIENT_ANSWER,
        answerParts: [{ text: NEUTRAL_INSUFFICIENT_ANSWER, sourceChunkIds: [] }],
        citations: [],
        sources: [],
      }),
    );
    expect(display.status).toBe("insufficient_evidence");
    expect(display.sources).toEqual([]);
    expect(display.answer).toBe(NEUTRAL_INSUFFICIENT_ANSWER);
  });
});

describe("isAskDisplayResponse / limits", () => {
  it("rejects incomplete payloads", () => {
    expect(isAskDisplayResponse({ status: "answered" })).toBe(false);
    expect(
      isAskDisplayResponse({
        status: "answered",
        answer: "x",
        answerParts: [],
        sources: [],
      }),
    ).toBe(false);
    expect(
      isAskDisplayResponse({
        requestId: "rid",
        status: "answered",
        answer: "x",
        answerParts: [],
        sources: [],
      }),
    ).toBe(true);
  });

  it("documents max question length", () => {
    expect(ASK_MAX_QUESTION_CHARS).toBe(2000);
  });
});
