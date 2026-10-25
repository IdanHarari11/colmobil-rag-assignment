import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { TraceEvent, TraceTokenUsage } from "./types";

export interface TraceSummary {
  requestId: string;
  outcome?: string;
  answerStatus?: string;
  totalDurationMs?: number;
  startedAt?: string;
  finishedAt?: string;
  historyPresent?: boolean;
  historyMessageCount?: number;
  unresolvedReferenceCount?: number;
  stages: Array<{
    stage: string;
    status: string;
    durationMs: number | null;
    nestedUnder?: string;
    includesNested?: string[];
    errorCode?: string;
    usage?: TraceTokenUsage;
  }>;
  citedChunkIds?: string[];
  retrievalHits?: unknown;
  tokenTotals: {
    inputTokens: number | null;
    outputTokens: number | null;
    cachedInputTokens: number | null;
  };
  scopeNote?: string;
  eventCount: number;
}

export async function listTraceFiles(
  directory = path.join(process.cwd(), "data", "traces"),
): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(/*turbopackIgnore: true*/ directory);
  } catch {
    return [];
  }
  return names
    .filter((n) => n.endsWith(".jsonl") && n.startsWith("ask-traces"))
    .map((n) => path.join(directory, n))
    .sort();
}

export async function loadTraceEvents(
  requestId: string,
  directory?: string,
): Promise<TraceEvent[]> {
  const files = await listTraceFiles(directory);
  const matched: TraceEvent[] = [];
  for (const file of files) {
    const raw = await readFile(file, "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (
        parsed &&
        typeof parsed === "object" &&
        (parsed as TraceEvent).requestId === requestId
      ) {
        matched.push(parsed as TraceEvent);
      }
    }
  }
  matched.sort((a, b) => a.seq - b.seq);
  return matched;
}

export function summarizeTraceEvents(events: TraceEvent[]): TraceSummary | null {
  if (events.length === 0) return null;
  const requestId = events[0]!.requestId;
  const stages: TraceSummary["stages"] = [];
  let outcome: string | undefined;
  let answerStatus: string | undefined;
  let totalDurationMs: number | undefined;
  let startedAt: string | undefined;
  let finishedAt: string | undefined;
  let historyPresent: boolean | undefined;
  let historyMessageCount: number | undefined;
  let unresolvedReferenceCount: number | undefined;
  let citedChunkIds: string[] | undefined;
  let retrievalHits: unknown;
  let scopeNote: string | undefined;
  let inputSum = 0;
  let outputSum = 0;
  let cachedSum = 0;
  let sawInput = false;
  let sawOutput = false;
  let sawCached = false;

  for (const event of events) {
    if (event.type === "start") {
      startedAt = event.payload.startedAt;
      historyPresent = event.payload.historyPresent;
      historyMessageCount = event.payload.historyMessageCount;
    } else if (event.type === "stage") {
      stages.push({
        stage: event.payload.stage,
        status: event.payload.status,
        durationMs: event.payload.durationMs,
        nestedUnder: event.payload.nestedUnder,
        includesNested: event.payload.includesNested,
        errorCode: event.payload.errorCode,
        usage: event.payload.usage,
      });
      const usage = event.payload.usage;
      if (usage) {
        if (typeof usage.inputTokens === "number") {
          inputSum += usage.inputTokens;
          sawInput = true;
        }
        if (typeof usage.outputTokens === "number") {
          outputSum += usage.outputTokens;
          sawOutput = true;
        }
        if (typeof usage.cachedInputTokens === "number") {
          cachedSum += usage.cachedInputTokens;
          sawCached = true;
        }
      }
      if (event.payload.stage === "retrieval") {
        retrievalHits = event.payload.details?.hits;
      }
      if (
        event.payload.stage === "rewrite" &&
        typeof event.payload.details?.unresolvedReferenceCount === "number"
      ) {
        unresolvedReferenceCount = event.payload.details
          .unresolvedReferenceCount as number;
      }
    } else if (event.type === "end") {
      outcome = event.payload.outcome;
      answerStatus = event.payload.answerStatus;
      totalDurationMs = event.payload.totalDurationMs;
      finishedAt = event.payload.finishedAt;
      citedChunkIds = event.payload.citedChunkIds;
      unresolvedReferenceCount =
        event.payload.unresolvedReferenceCount ?? unresolvedReferenceCount;
      scopeNote = event.payload.scopeNote;
    }
  }

  return {
    requestId,
    outcome,
    answerStatus,
    totalDurationMs,
    startedAt,
    finishedAt,
    historyPresent,
    historyMessageCount,
    unresolvedReferenceCount,
    stages,
    citedChunkIds,
    retrievalHits,
    tokenTotals: {
      inputTokens: sawInput ? inputSum : null,
      outputTokens: sawOutput ? outputSum : null,
      cachedInputTokens: sawCached ? cachedSum : null,
    },
    scopeNote,
    eventCount: events.length,
  };
}
