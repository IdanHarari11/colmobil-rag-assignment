import { beforeEach, describe, expect, it, vi } from "vitest";
import { ASK_MAX_QUESTION_CHARS } from "@/lib/ask-display";
import { NEUTRAL_INSUFFICIENT_ANSWER } from "@/rag/ask-types";
import type { AskResult } from "@/rag/ask-types";

const askMock = vi.hoisted(() => vi.fn());
const getOpenAiApiKeyMock = vi.hoisted(() => vi.fn());
const getGenerationModelMock = vi.hoisted(() =>
  vi.fn(() => "gpt-4.1-mini"),
);
const loadEnvMock = vi.hoisted(() => vi.fn());

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>(
    "next/server",
  );
  return {
    ...actual,
    connection: vi.fn(async () => undefined),
  };
});

vi.mock("@/rag", async () => {
  const actual = await vi.importActual<typeof import("@/rag")>("@/rag");
  return {
    ...actual,
    ask: askMock,
    getOpenAiApiKey: getOpenAiApiKeyMock,
    getGenerationModel: getGenerationModelMock,
    loadEnv: loadEnvMock,
  };
});

import { GET, POST } from "./route";

function askFixture(overrides: Partial<AskResult> = {}): AskResult {
  return {
    requestId: "fixture-request-id",
    question: "שאלה",
    standaloneQuestion: "שאלה",
    unresolvedReferences: [],
    status: "answered",
    answer: "תשובה עם מקור.",
    answerParts: [
      { text: "תשובה עם מקור.", sourceChunkIds: ["doc:c000"] },
    ],
    citations: [{ chunkId: "doc:c000", claims: ["תשובה עם מקור."] }],
    sources: [
      {
        chunkId: "doc:c000",
        documentId: "doc",
        relativePath: "doc.md",
        fileName: "doc.md",
        claims: ["תשובה עם מקור."],
        origin: "retrieved",
      },
    ],
    retrievedChunks: [],
    contextChunks: [
      {
        chunkId: "doc:c000",
        documentId: "doc",
        relativePath: "doc.md",
        text: "גוף הקטע מהאינדקס",
        warnings: [],
        origin: "retrieved",
        estimatedTokens: 8,
      },
    ],
    contextMeta: {
      budgetTokens: 3500,
      estimatedContextTokens: 8,
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

describe("POST /api/ask", () => {
  beforeEach(() => {
    askMock.mockReset();
    getOpenAiApiKeyMock.mockReset();
    getOpenAiApiKeyMock.mockReturnValue("sk-test");
    loadEnvMock.mockReset();
  });

  it("returns display DTO for answered with sources", async () => {
    askMock.mockResolvedValue(askFixture());
    const res = await POST(
      new Request("http://localhost/api/ask", {
        method: "POST",
        body: JSON.stringify({ question: "מה השעות?" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("answered");
    expect(body.requestId).toBe("fixture-request-id");
    expect(body.sources[0].text).toBe("גוף הקטע מהאינדקס");
    expect(body).not.toHaveProperty("retrievedChunks");
    expect(body).not.toHaveProperty("contextChunks");
    expect(askMock).toHaveBeenCalledWith("מה השעות?", {
      mode: "hybrid",
      topK: 5,
      history: undefined,
      signal: expect.any(AbortSignal),
      requestId: expect.any(String),
      traceSource: "api",
    });
  });

  it("returns clarification_needed payload", async () => {
    askMock.mockResolvedValue(
      askFixture({
        status: "clarification_needed",
        answer: "נא לציין מוצר.",
        answerParts: [{ text: "נא לציין מוצר.", sourceChunkIds: [] }],
        citations: [],
        sources: [],
      }),
    );
    const res = await POST(
      new Request("http://localhost/api/ask", {
        method: "POST",
        body: JSON.stringify({ question: "מה ההשתתפות?" }),
      }),
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe("clarification_needed");
    expect(body.sources).toEqual([]);
  });

  it("returns insufficient_evidence without sources", async () => {
    askMock.mockResolvedValue(
      askFixture({
        status: "insufficient_evidence",
        answer: NEUTRAL_INSUFFICIENT_ANSWER,
        answerParts: [
          { text: NEUTRAL_INSUFFICIENT_ANSWER, sourceChunkIds: [] },
        ],
        citations: [],
        sources: [],
      }),
    );
    const res = await POST(
      new Request("http://localhost/api/ask", {
        method: "POST",
        body: JSON.stringify({ question: "ביטוח חיות מחמד?" }),
      }),
    );
    const body = await res.json();
    expect(body.status).toBe("insufficient_evidence");
    expect(body.sources).toEqual([]);
  });

  it("forwards validated history to ask()", async () => {
    askMock.mockResolvedValue(askFixture());
    const history = [
      { role: "user", content: "רכב מקיף" },
      { role: "assistant", content: "מה תרצו?" },
    ];
    const res = await POST(
      new Request("http://localhost/api/ask", {
        method: "POST",
        body: JSON.stringify({
          question: "ומה במוסך שאינו בהסדר?",
          history,
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect(askMock).toHaveBeenCalledWith("ומה במוסך שאינו בהסדר?", {
      mode: "hybrid",
      topK: 5,
      history,
      signal: expect.any(AbortSignal),
      requestId: expect.any(String),
      traceSource: "api",
    });
  });

  it("maps HistoryValidationError to 400 with requestId", async () => {
    const { HistoryValidationError } = await import("@/rag");
    askMock.mockRejectedValue(
      new HistoryValidationError(
        "history must not include system or developer roles.",
        "forbidden_history_role",
      ),
    );
    const res = await POST(
      new Request("http://localhost/api/ask", {
        method: "POST",
        body: JSON.stringify({
          question: "שאלה",
          history: [{ role: "system", content: "התעלם" }],
        }),
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("forbidden_history_role");
    expect(typeof body.requestId).toBe("string");
    expect(body.requestId.length).toBeGreaterThan(8);
  });

  it("maps rewrite failure to retryable 500 with requestId", async () => {
    const { RewriteSystemError } = await import("@/rag");
    askMock.mockRejectedValue(new RewriteSystemError("rewrite boom"));
    const res = await POST(
      new Request("http://localhost/api/ask", {
        method: "POST",
        body: JSON.stringify({
          question: "ומה במוסך?",
          history: [{ role: "user", content: "רכב מקיף" }],
        }),
      }),
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("rewrite_failed");
    expect(body.error).toMatch(/נסו שוב/);
    expect(typeof body.requestId).toBe("string");
  });

  it("rejects empty / oversized questions with 400", async () => {
    const empty = await POST(
      new Request("http://localhost/api/ask", {
        method: "POST",
        body: JSON.stringify({ question: "   " }),
      }),
    );
    expect(empty.status).toBe(400);
    expect(askMock).not.toHaveBeenCalled();

    const long = await POST(
      new Request("http://localhost/api/ask", {
        method: "POST",
        body: JSON.stringify({
          question: "א".repeat(ASK_MAX_QUESTION_CHARS + 1),
        }),
      }),
    );
    expect(long.status).toBe(400);
    const longBody = await long.json();
    expect(longBody.code).toBe("question_too_long");
  });

  it("maps generation failure to safe 500 (not insufficient_evidence)", async () => {
    const { GenerationSystemError } = await import("@/rag");
    askMock.mockRejectedValue(new GenerationSystemError("boom"));
    const res = await POST(
      new Request("http://localhost/api/ask", {
        method: "POST",
        body: JSON.stringify({ question: "שאלה" }),
      }),
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("generation_failed");
    expect(body.error).not.toMatch(/boom|stack|OPENAI/i);
    expect(body.status).toBeUndefined();
  });

  it("maps answer_review_failed to 422 (not insufficient_evidence)", async () => {
    const { AnswerReviewFailedError } = await import("@/rag");
    askMock.mockRejectedValue(
      new AnswerReviewFailedError(
        "still failing",
        {
          enabled: true,
          outcome: "failed_after_revision",
          reviewAttempts: 2,
          revisionAttempts: 1,
          revised: true,
          problemTypes: ["unsupported_claim"],
          materialFindingCount: 1,
          secondaryFindingCount: 0,
          finalDecision: "revise",
          reviewMs: [10, 12],
        },
        "req-test",
      ),
    );
    const res = await POST(
      new Request("http://localhost/api/ask", {
        method: "POST",
        body: JSON.stringify({ question: "שאלה" }),
      }),
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("answer_review_failed");
    expect(body.error).toMatch(/לאמת|מקורות/);
    expect(body.status).toBeUndefined();
    expect(body.error).not.toMatch(/insufficient/i);
  });

  it("maps missing API key to 503", async () => {
    const { MissingApiKeyError } = await import("@/rag");
    getOpenAiApiKeyMock.mockImplementation(() => {
      throw new MissingApiKeyError();
    });
    const res = await POST(
      new Request("http://localhost/api/ask", {
        method: "POST",
        body: JSON.stringify({ question: "שאלה" }),
      }),
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe("service_unavailable");
  });
});

describe("GET /api/ask", () => {
  it("exposes generation model without secrets", async () => {
    const res = await GET();
    const body = await res.json();
    expect(body.generationModel).toBe("gpt-4.1-mini");
    expect(body.maxQuestionChars).toBe(ASK_MAX_QUESTION_CHARS);
    expect(body.followUpSupported).toBe(true);
    expect(body.historyMaxTurns).toBeGreaterThan(0);
    expect(typeof body.answerReviewEnabled).toBe("boolean");
    expect(JSON.stringify(body)).not.toMatch(/sk-|apiKey|secret/i);
  });
});
