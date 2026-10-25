import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Chunk } from "../../chunking/types";
import { ask } from "../ask";
import { buildIndexFromVectors } from "../build-index";
import type { GenerateAnswerResult } from "../generate";
import { RewriteSystemError } from "../rewrite-query";
import {
  DEFAULT_EMBEDDING_DIMENSIONS,
  DEFAULT_EMBEDDING_MODEL,
} from "../types";
import { GenerationSystemError } from "../ask-types";
import { JsonlTraceWriter, MemoryTraceWriter, TRACE_SCHEMA_VERSION } from "./index";
import { loadTraceEvents, summarizeTraceEvents } from "./read";
import type { DocumentRelationsManifest } from "../document-relations";

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

function testIndex() {
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
        usage: { promptTokens: 3, totalTokens: 3 },
        config: embedderConfig,
      };
    },
  };
  return { index, embedder, documentRelationsManifest: EMPTY_MANIFEST };
}

const generateOk = async (): Promise<GenerateAnswerResult> => ({
  payload: {
    status: "answered",
    answerParts: [{ text: "שעות.", sourceChunkIds: ["docA:c000"] }],
  },
  rawText: "{}",
  model: "mock-model",
      modelRequested: "mock-model",
      modelReturned: "mock-model",
      samplingProfile: { kind: "classic_sampling", temperature: 0 },
  usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
  latencyMs: 2,
});

describe("ask tracing", () => {
  it("skips rewrite without history and ends success once", async () => {
    const { index, embedder } = testIndex();
    const writer = new MemoryTraceWriter();
    await ask(
      "מה שעות המוקד?",
      { mode: "hybrid", topK: 2, traceWriter: writer, answerReviewEnabled: false, traceSource: "test" },
      { index, embedder, generate: generateOk, documentRelationsManifest: EMPTY_MANIFEST },
    );
    const stages = writer.events.filter((e) => e.type === "stage");
    const rewrite = stages.find(
      (e) => e.type === "stage" && e.payload.stage === "rewrite",
    );
    expect(rewrite && rewrite.type === "stage" && rewrite.payload.status).toBe(
      "skipped",
    );
    expect(
      stages.some((e) => e.type === "stage" && e.payload.stage === "embedding"),
    ).toBe(true);
    const ends = writer.events.filter((e) => e.type === "end");
    expect(ends).toHaveLength(1);
    expect(ends[0]?.type === "end" && ends[0].payload.outcome).toBe("success");
    const blob = JSON.stringify(writer.events);
    expect(blob).not.toContain("מה שעות המוקד");
    expect(blob).not.toContain("שעות.");
  });

  it("records rewrite usage when history is present", async () => {
    const { index, embedder } = testIndex();
    const writer = new MemoryTraceWriter();
    await ask(
      "ומה במוסך?",
      {
        mode: "lexical",
        topK: 2,
        history: [{ role: "user", content: "רכב מקיף מ-1.3.2026" }],
        traceWriter: writer,
        answerReviewEnabled: false, traceSource: "test",
      },
      {
        index,
        embedder,
        documentRelationsManifest: EMPTY_MANIFEST,
        generate: async () => ({
          payload: {
            status: "clarification_needed",
            answerParts: [{ text: "הבהרה", sourceChunkIds: [] }],
          },
          rawText: "{}",
          model: "mock",
      modelRequested: "mock-model",
      modelReturned: "mock-model",
      samplingProfile: { kind: "classic_sampling", temperature: 0 },
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          latencyMs: 1,
        }),
        rewrite: async () => ({
          standaloneQuestion: "השתתפות מוסך רכב מקיף 1.3.2026",
          unresolvedReferences: ["x"],
          model: "mock-rewrite",
          usage: { promptTokens: 40, completionTokens: 12, totalTokens: 52 },
          latencyMs: 9,
        }),
      },
    );
    const rewrite = writer.events.find(
      (e) => e.type === "stage" && e.payload.stage === "rewrite",
    );
    expect(rewrite?.type).toBe("stage");
    if (rewrite?.type === "stage") {
      expect(rewrite.payload.status).toBe("ok");
      expect(rewrite.payload.usage?.inputTokens).toBe(40);
      expect(rewrite.payload.usage?.outputTokens).toBe(12);
      expect(rewrite.payload.details?.unresolvedReferenceCount).toBe(1);
    }
    const start = writer.events.find((e) => e.type === "start");
    expect(start?.type === "start" && start.payload.historyPresent).toBe(true);
    expect(JSON.stringify(writer.events)).not.toContain("רכב מקיף מ-1.3.2026");
  });

  it("keeps parallel request ids and events separated", async () => {
    const { index, embedder } = testIndex();
    const writer = new MemoryTraceWriter();
    const [a, b] = await Promise.all([
      ask(
        "שאלה א",
        {
          mode: "hybrid",
          topK: 1,
          requestId: "req-a",
          traceWriter: writer,
          answerReviewEnabled: false, traceSource: "test",
        },
        { index, embedder, generate: generateOk, documentRelationsManifest: EMPTY_MANIFEST },
      ),
      ask(
        "שאלה ב",
        {
          mode: "hybrid",
          topK: 1,
          requestId: "req-b",
          traceWriter: writer,
          answerReviewEnabled: false, traceSource: "test",
        },
        { index, embedder, generate: generateOk, documentRelationsManifest: EMPTY_MANIFEST },
      ),
    ]);
    expect(a.requestId).toBe("req-a");
    expect(b.requestId).toBe("req-b");
    const ids = new Set(writer.events.map((e) => e.requestId));
    expect(ids).toEqual(new Set(["req-a", "req-b"]));
    for (const id of ["req-a", "req-b"]) {
      const ends = writer.events.filter(
        (e) => e.requestId === id && e.type === "end",
      );
      expect(ends).toHaveLength(1);
    }
  });

  it("records controlled rewrite error without a later success", async () => {
    const { index, embedder } = testIndex();
    const writer = new MemoryTraceWriter();
    await expect(
      ask(
        "המשך",
        {
          mode: "lexical",
          topK: 1,
          history: [{ role: "user", content: "קודם" }],
          requestId: "req-err",
          traceWriter: writer,
          answerReviewEnabled: false, traceSource: "test",
        },
        {
          index,
          embedder,
        documentRelationsManifest: EMPTY_MANIFEST,
          rewrite: async () => {
            throw new RewriteSystemError("boom");
          },
        },
      ),
    ).rejects.toBeInstanceOf(GenerationSystemError);

    const end = writer.events.find((e) => e.type === "end");
    expect(end?.type === "end" && end.payload.outcome).toBe("error");
    expect(end?.type === "end" && end.payload.errorCode).toBe("rewrite_failed");
    expect(writer.events.some((e) => e.type === "end" && e.payload.outcome === "success")).toBe(
      false,
    );
    expect(JSON.stringify(writer.events)).not.toContain("boom");
  });

  it("records cancelled outcome on abort", async () => {
    const { index, embedder } = testIndex();
    const writer = new MemoryTraceWriter();
    const controller = new AbortController();
    controller.abort();
    await expect(
      ask(
        "שאלה",
        {
          mode: "hybrid",
          topK: 1,
          signal: controller.signal,
          requestId: "req-cancel",
          traceWriter: writer,
          answerReviewEnabled: false, traceSource: "test",
        },
        { index, embedder, generate: generateOk, documentRelationsManifest: EMPTY_MANIFEST },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    const end = writer.events.find((e) => e.type === "end");
    expect(end?.type === "end" && end.payload.outcome).toBe("cancelled");
    expect(
      writer.events.some(
        (e) => e.type === "end" && e.payload.outcome === "success",
      ),
    ).toBe(false);
  });

  it("does not fail ask when trace write fails", async () => {
    const { index, embedder } = testIndex();
    const writer = new MemoryTraceWriter();
    writer.failNext = true;
    const result = await ask(
      "מה שעות המוקד?",
      { mode: "hybrid", topK: 2, traceWriter: writer, answerReviewEnabled: false, traceSource: "test" },
      { index, embedder, generate: generateOk, documentRelationsManifest: EMPTY_MANIFEST },
    );
    expect(result.status).toBe("answered");
  });

  it("does not leak synthetic secrets from error messages into the log", async () => {
    const { index, embedder } = testIndex();
    const writer = new MemoryTraceWriter();
    await expect(
      ask(
        "שאלה עם SECRET_KEY_XYZ",
        {
          mode: "hybrid",
          topK: 1,
          history: [{ role: "user", content: "SECRET_KEY_XYZ prior" }],
          traceWriter: writer,
          answerReviewEnabled: false, traceSource: "test",
        },
        {
          index,
          embedder,
        documentRelationsManifest: EMPTY_MANIFEST,
          rewrite: async () => {
            throw new RewriteSystemError(
              "upstream failed Authorization: Bearer SECRET_KEY_XYZ",
            );
          },
        },
      ),
    ).rejects.toBeInstanceOf(Error);
    const blob = JSON.stringify(writer.events);
    expect(blob).not.toContain("SECRET_KEY_XYZ");
    expect(blob).not.toContain("Bearer");
  });
});

describe("JsonlTraceWriter rotation", () => {
  let dir: string;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("rotates oversized files and keeps valid JSON lines", async () => {
    dir = path.join(os.tmpdir(), `ofek-trace-${process.pid}-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const writer = new JsonlTraceWriter({
      directory: dir,
      maxFileBytes: 200,
      maxRotatedFiles: 5,
    });

    for (let i = 0; i < 30; i += 1) {
      await writer.append({
        schemaVersion: TRACE_SCHEMA_VERSION,
        requestId: `rot-${i}`,
        type: "start",
        seq: 1,
        at: new Date().toISOString(),
        payload: {
          startedAt: new Date().toISOString(),
          source: "test",
          codeVersion: { value: "test", localChangesUnknown: true },
          promptBundleId: "p",
          config: {
            retrievalMode: "hybrid",
            topK: 5,
            contextBudgetTokens: 3500,
            generationModel: "m",
            historyWindowMaxTurns: 6,
            historyWindowMaxTotalChars: 6000,
          },
          historyPresent: false,
          historyMessageCount: 0,
        },
      });
    }

    const { readdir } = await import("node:fs/promises");
    const files = await readdir(dir);
    const jsonl = files.filter((f) => f.endsWith(".jsonl"));
    expect(jsonl.length).toBeGreaterThan(1);

    for (const file of jsonl) {
      const raw = await readFile(path.join(dir, file), "utf8");
      for (const line of raw.split("\n").filter(Boolean)) {
        expect(() => JSON.parse(line)).not.toThrow();
      }
    }

    // Seed a known id and load via reader
    await writeFile(
      path.join(dir, "ask-traces.jsonl"),
      `${JSON.stringify({
        schemaVersion: TRACE_SCHEMA_VERSION,
        requestId: "find-me",
        type: "end",
        seq: 2,
        at: new Date().toISOString(),
        payload: {
          outcome: "success",
          finishedAt: new Date().toISOString(),
          totalDurationMs: 1,
          scopeNote: "test",
          answerStatus: "answered",
          citedChunkIds: ["a:c000"],
        },
      })}\n`,
      "utf8",
    );
    const events = await loadTraceEvents("find-me", dir);
    const summary = summarizeTraceEvents(events);
    expect(summary?.requestId).toBe("find-me");
    expect(summary?.outcome).toBe("success");
  });
});
