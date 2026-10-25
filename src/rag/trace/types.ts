/**
 * Ask-path tracing schema (Stage 3).
 * Privacy: no questions, answers, history text, source bodies, or full prompts.
 */

export const TRACE_SCHEMA_VERSION = 1 as const;

export type TraceOutcome = "success" | "error" | "cancelled";

export type TraceStageName =
  | "rewrite"
  | "embedding"
  | "retrieval"
  | "context"
  | "generation"
  | "validation"
  | "semantic_review"
  | "revision";

export type TraceStageStatus = "ok" | "error" | "cancelled" | "skipped";

/** Token usage for one provider call. Missing values are null, never fabricated zeros. */
export interface TraceTokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  /** Cached portion of input when the provider reports it. Not added again on top of inputTokens. */
  cachedInputTokens: number | null;
  totalTokens: number | null;
}

export interface TraceScore {
  /** Primary score for the active retrieval mode. */
  value: number;
  /** e.g. cosine | bm25 | rrf */
  type: string;
  semanticScore?: number;
  lexicalScore?: number;
  fusionScore?: number;
  semanticRank?: number;
  lexicalRank?: number;
}

export interface TraceRetrievedHit {
  chunkId: string;
  rank: number;
  score: TraceScore;
}

export interface TraceOmittedChunk {
  chunkId: string;
  reasonCode: string;
}

export interface TraceCodeVersion {
  /** Git SHA or package version when known. */
  value: string;
  /**
   * True when we cannot tell if the working tree differs from `value`
   * (no dirty detection, or git unavailable).
   */
  localChangesUnknown: boolean;
}

export interface TraceIndexIdentity {
  formatVersion: number;
  model: string;
  dimensions: number;
  chunkCount: number;
  chunksInputHash?: string;
  embeddingTextHash?: string;
}

export interface TraceConfigSnapshot {
  retrievalMode: string;
  topK: number;
  contextBudgetTokens: number;
  generationModel: string;
  embeddingModel?: string;
  historyWindowMaxTurns: number;
  historyWindowMaxTotalChars: number;
  /** Stage 5 semantic draft review toggle at request start. */
  answerReviewEnabled?: boolean;
}

export interface TraceStartPayload {
  startedAt: string;
  source: "api" | "cli" | "eval" | "test" | "unknown";
  codeVersion: TraceCodeVersion;
  /** Stable ids derived from prompt constants (not full prompt text). */
  promptBundleId: string;
  config: TraceConfigSnapshot;
  historyPresent: boolean;
  /** Messages retained after the history window (prior turns only). */
  historyMessageCount: number;
}

export interface TraceStagePayload {
  stage: TraceStageName;
  status: TraceStageStatus;
  /** Wall duration of this stage span (ms). */
  durationMs: number | null;
  /**
   * When set, this stage runs inside another stage's wall clock
   * (do not sum with the parent as independent sequential work).
   */
  nestedUnder?: TraceStageName;
  /** Stages whose durations are nested inside this one. */
  includesNested?: TraceStageName[];
  errorCode?: string;
  usage?: TraceTokenUsage;
  providerCalls?: number;
  /** Stage-specific structured fields (ids/counts only). */
  details?: Record<string, unknown>;
}

export interface TraceEndPayload {
  outcome: TraceOutcome;
  finishedAt: string;
  totalDurationMs: number;
  answerStatus?: string;
  citedChunkIds?: string[];
  unresolvedReferenceCount?: number;
  /** Stage 5 review outcome code when review ran or was skipped. */
  answerReviewOutcome?: string;
  index?: TraceIndexIdentity;
  errorCode?: string;
  errorStage?: TraceStageName | "ask";
  /**
   * Scope note: ask-path only. Title-generation API calls are not included
   * unless wired into this tracer (they are not in Stage 3).
   */
  scopeNote: string;
}

export type TraceEventType = "start" | "stage" | "end";

export interface TraceEventBase {
  schemaVersion: typeof TRACE_SCHEMA_VERSION;
  requestId: string;
  type: TraceEventType;
  seq: number;
  at: string;
}

export type TraceStartEvent = TraceEventBase & {
  type: "start";
  payload: TraceStartPayload;
};

export type TraceStageEvent = TraceEventBase & {
  type: "stage";
  payload: TraceStagePayload;
};

export type TraceEndEvent = TraceEventBase & {
  type: "end";
  payload: TraceEndPayload;
};

export type TraceEvent = TraceStartEvent | TraceStageEvent | TraceEndEvent;

export const TRACE_SCOPE_NOTE =
  "ask-path only; thread-title generation is not traced here.";

export const TRACE_LOG_POLICY = {
  directoryRelative: "data/traces",
  activeFileName: "ask-traces.jsonl",
  maxFileBytes: 5 * 1024 * 1024,
  maxRotatedFiles: 20,
  format: "jsonl",
  contents:
    "request metadata, stage timings, token usage, chunk ids/scores, safe error codes — no question/answer/history/source text or secrets",
} as const;
