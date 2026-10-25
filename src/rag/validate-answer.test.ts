import { describe, expect, it } from "vitest";
import type { ContextChunk } from "./ask-types";
import {
  GenerationSystemError,
  NEUTRAL_INSUFFICIENT_ANSWER,
} from "./ask-types";
import { assembleAnswerFromParts } from "./validate-answer";

function ctx(chunkId: string): ContextChunk {
  return {
    chunkId,
    documentId: "docA",
    relativePath: "policies/docA.md",
    text: "body",
    documentTitle: "Doc A",
    sectionPath: ["Doc A"],
    pages: [2],
    warnings: [],
    origin: "retrieved",
    estimatedTokens: 10,
  };
}

describe("assembleAnswerFromParts", () => {
  it("builds answer and citations from the same parts only", () => {
    const assembled = assembleAnswerFromParts(
      {
        status: "answered",
        answerParts: [
          { text: "חלק א", sourceChunkIds: ["docA:c000"] },
          { text: "חלק ב", sourceChunkIds: ["docA:c001", "docA:c000"] },
        ],
      },
      [ctx("docA:c000"), ctx("docA:c001")],
    );
    expect(assembled.answer).toBe("חלק א\n\nחלק ב");
    expect(assembled.citations.map((c) => c.chunkId).sort()).toEqual([
      "docA:c000",
      "docA:c001",
    ]);
    expect(assembled.citations.find((c) => c.chunkId === "docA:c000")?.claims).toEqual([
      "חלק א",
      "חלק ב",
    ]);
    expect(assembled.sources.every((s) => s.fileName === "docA.md")).toBe(true);
  });

  it("rejects a sourceChunkId not supplied in context", () => {
    expect(() =>
      assembleAnswerFromParts(
        {
          status: "answered",
          answerParts: [
            { text: "טענה", sourceChunkIds: ["forged:c999"] },
          ],
        },
        [ctx("docA:c000")],
      ),
    ).toThrow(GenerationSystemError);
  });

  it("rejects factual part without sources", () => {
    expect(() =>
      assembleAnswerFromParts(
        {
          status: "answered",
          answerParts: [{ text: "טענה ללא מקור", sourceChunkIds: [] }],
        },
        [ctx("docA:c000")],
      ),
    ).toThrow(GenerationSystemError);
  });

  it("uses neutral insufficient_evidence wording with empty citations", () => {
    const assembled = assembleAnswerFromParts(
      { status: "insufficient_evidence", answerParts: [] },
      [ctx("docA:c000")],
    );
    expect(assembled.answer).toBe(NEUTRAL_INSUFFICIENT_ANSWER);
    expect(assembled.citations).toEqual([]);
    expect(assembled.sources).toEqual([]);
    expect(assembled.answerParts).toEqual([]);
  });

  it("clarification_needed uses part text and strips any source ids", () => {
    const assembled = assembleAnswerFromParts(
      {
        status: "clarification_needed",
        answerParts: [
          { text: "לאיזה מוצר?", sourceChunkIds: ["docA:c000"] },
        ],
      },
      [ctx("docA:c000")],
    );
    expect(assembled.status).toBe("clarification_needed");
    expect(assembled.answer).toBe("לאיזה מוצר?");
    expect(assembled.citations).toEqual([]);
    expect(assembled.answerParts[0]?.sourceChunkIds).toEqual([]);
  });
});
