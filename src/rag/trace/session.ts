import type { LocalIndex } from "../types";
import type { RetrievalHit } from "../types";
import type { ContextBuildResult } from "../ask-types";
import { createRequestId } from "./request-id";
import { resolveCodeVersion, resolvePromptBundleId } from "./code-version";
import { inferErrorStage, isAbortError, safeErrorCode } from "./safe-error";
import { toTraceTokenUsage } from "./usage";
import { getDefaultTraceWriter, type TraceWriter } from "./writer";
import {
  TRACE_SCHEMA_VERSION,
  TRACE_SCOPE_NOTE,
  type TraceConfigSnapshot,
  type TraceEndPayload,
  type TraceEvent,
  type TraceOutcome,
  type TraceStageName,
  type TraceStagePayload,
  type TraceStartPayload,
  type TraceTokenUsage,
} from "./types";

export type TraceSource = TraceStartPayload["source"];

export interface AskTraceSessionOptions {
  requestId?: string;
  source?: TraceSource;
  writer?: TraceWriter;
  /** When false, session is a no-op (still exposes requestId). */
  enabled?: boolean;
  config: TraceConfigSnapshot;
  historyPresent: boolean;
  historyMessageCount: number;
}

/**
 * Per-request trace collector. Holds requestId and event sequence locally —
 * never stores request state in module globals.
 */
export class AskTraceSession {
  readonly requestId: string;
  private readonly writer: TraceWriter;
  private readonly enabled: boolean;
  private seq = 0;
  private readonly wallStarted: number;
  private ended = false;
  private indexIdentity: TraceEndPayload["index"];
  private unresolvedReferenceCount = 0;

  constructor(options: AskTraceSessionOptions) {
    this.requestId = options.requestId ?? createRequestId();
    this.writer = options.writer ?? getDefaultTraceWriter();
    this.enabled = options.enabled !== false;
    this.wallStarted = performance.now();

    void this.emit({
      schemaVersion: TRACE_SCHEMA_VERSION,
      requestId: this.requestId,
      type: "start",
      seq: this.nextSeq(),
      at: new Date().toISOString(),
      payload: {
        startedAt: new Date().toISOString(),
        source: options.source ?? "unknown",
        codeVersion: resolveCodeVersion(),
        promptBundleId: resolvePromptBundleId(),
        config: options.config,
        historyPresent: options.historyPresent,
        historyMessageCount: options.historyMessageCount,
      },
    });
  }

  setIndex(index: LocalIndex): void {
    this.indexIdentity = {
      formatVersion: index.manifest.formatVersion,
      model: index.manifest.model,
      dimensions: index.manifest.dimensions,
      chunkCount: index.manifest.chunkCount,
      chunksInputHash: index.manifest.chunksInputHash,
      embeddingTextHash: index.manifest.embeddingTextHash,
    };
  }

  setUnresolvedReferenceCount(count: number): void {
    this.unresolvedReferenceCount = count;
  }

  recordStage(payload: TraceStagePayload): void {
    if (this.ended) return;
    void this.emit({
      schemaVersion: TRACE_SCHEMA_VERSION,
      requestId: this.requestId,
      type: "stage",
      seq: this.nextSeq(),
      at: new Date().toISOString(),
      payload,
    });
  }

  recordSkipped(stage: TraceStageName, reasonCode: string): void {
    this.recordStage({
      stage,
      status: "skipped",
      durationMs: 0,
      details: { reasonCode },
    });
  }

  recordRewriteOk(args: {
    durationMs: number;
    usage?: TraceTokenUsage;
    unresolvedReferenceCount: number;
    model: string;
  }): void {
    this.setUnresolvedReferenceCount(args.unresolvedReferenceCount);
    this.recordStage({
      stage: "rewrite",
      status: "ok",
      durationMs: args.durationMs,
      usage: args.usage,
      providerCalls: 1,
      details: {
        model: args.model,
        unresolvedReferenceCount: args.unresolvedReferenceCount,
      },
    });
  }

  recordRetrievalOk(args: {
    durationMs: number;
    embeddingMs: number;
    localSearchMs: number;
    embeddingUsage?: TraceTokenUsage;
    mode: string;
    hits: RetrievalHit[];
  }): void {
    // Nested embedding span (do not sum with retrieval wall as independent).
    this.recordStage({
      stage: "embedding",
      status: "ok",
      durationMs: args.embeddingMs,
      nestedUnder: "retrieval",
      usage: args.embeddingUsage,
      providerCalls: args.embeddingUsage ? 1 : 0,
      details: { purpose: "query_embedding" },
    });
    this.recordStage({
      stage: "retrieval",
      status: "ok",
      durationMs: args.durationMs,
      includesNested: ["embedding"],
      details: {
        mode: args.mode,
        localSearchMs: args.localSearchMs,
        hitCount: args.hits.length,
        hits: args.hits.map((hit, index) => ({
          chunkId: hit.chunkId,
          rank: index + 1,
          score: {
            value: hit.score,
            type: scoreTypeForMode(args.mode),
            ...(hit.semanticScore !== undefined
              ? { semanticScore: hit.semanticScore }
              : {}),
            ...(hit.lexicalScore !== undefined
              ? { lexicalScore: hit.lexicalScore }
              : {}),
            ...(hit.fusionScore !== undefined
              ? { fusionScore: hit.fusionScore }
              : {}),
            ...(hit.semanticRank !== undefined
              ? { semanticRank: hit.semanticRank }
              : {}),
            ...(hit.lexicalRank !== undefined
              ? { lexicalRank: hit.lexicalRank }
              : {}),
          },
        })),
      },
    });
  }

  recordContextOk(args: {
    durationMs: number;
    context: ContextBuildResult;
  }): void {
    const { context } = args;
    const applicability = context.applicability;
    this.recordStage({
      stage: "context",
      status: "ok",
      durationMs: args.durationMs,
      details: {
        budgetTokens: context.budgetTokens,
        estimatedContextTokens: context.estimatedContextTokens,
        tokenEstimateMethod: context.tokenEstimateMethod,
        contextComplete: context.contextComplete,
        includedChunkIds: context.contextChunks.map((c) => c.chunkId),
        includedOrigins: context.contextChunks.map((c) => c.origin),
        omittedRetrieved: context.omittedRetrieved.map((o) => ({
          chunkId: o.chunkId,
          reasonCode: sanitizeReason(o.reason),
        })),
        omittedExpansions: context.omittedExpansions.map((o) => ({
          chunkId: o.chunkId,
          reasonCode: sanitizeReason(o.reason),
        })),
        ...(applicability
          ? {
              manifestVersion: applicability.manifestVersion,
              dateKindsUsed: applicability.userTemporal.dateKindsUsed,
              versionDecisions: applicability.versionDecisions.map((d) => ({
                documentFamily: d.documentFamily,
                status: d.status,
                selectedDocumentId: d.selectedDocumentId,
                reasonCode: d.reasonCode,
                dateKindUsed: d.dateKindUsed,
                alternativeCount: d.alternativeDocumentIds.length,
              })),
              activatedRelationships: applicability.activatedRelationships.map(
                (r) => ({
                  type: r.type,
                  fromDocumentId: r.fromDocumentId,
                  toDocumentId: r.toDocumentId,
                  affectedSections: r.affectedSections,
                  reasonCode: r.reasonCode,
                }),
              ),
              unresolvedNotes: applicability.unresolvedNotes,
              linkedChunkIds: context.linkedChunkIds ?? [],
              enrichmentOmissions: context.enrichmentOmissions ?? [],
              hybridTopKChunkIds: context.hybridTopKChunkIds ?? [],
            }
          : {}),
      },
    });
  }

  recordGenerationOk(args: {
    durationMs: number;
    usage?: TraceTokenUsage;
    model: string;
  }): void {
    this.recordStage({
      stage: "generation",
      status: "ok",
      durationMs: args.durationMs,
      usage: args.usage,
      providerCalls: 1,
      details: { model: args.model },
    });
  }

  recordValidationOk(args: {
    durationMs: number;
    structureOk: boolean;
    citationsOk: boolean;
    invalidCitationIds: string[];
    /** Explicit: structure/chunkIds only — not semantic_review. */
    kind?: string;
  }): void {
    this.recordStage({
      stage: "validation",
      status: "ok",
      durationMs: args.durationMs,
      details: {
        kind: args.kind ?? "structure_and_chunk_ids",
        note: "Schema/chunkId validation only. Semantic claim support is stage semantic_review.",
        structureOk: args.structureOk,
        citationsOk: args.citationsOk,
        invalidCitationCount: args.invalidCitationIds.length,
      },
    });
  }

  recordSemanticReviewOk(args: {
    attempt: number;
    durationMs: number;
    usage?: TraceTokenUsage;
    decision: string;
    materialFindingCount: number;
    secondaryFindingCount: number;
    problemTypes: string[];
  }): void {
    this.recordStage({
      stage: "semantic_review",
      status: "ok",
      durationMs: args.durationMs,
      usage: args.usage,
      providerCalls: 1,
      details: {
        attempt: args.attempt,
        decision: args.decision,
        materialFindingCount: args.materialFindingCount,
        secondaryFindingCount: args.secondaryFindingCount,
        problemTypes: args.problemTypes,
        // No finding text / draft / source bodies.
      },
    });
  }

  recordRevisionOk(args: {
    attempt: number;
    durationMs: number;
    usage?: TraceTokenUsage;
  }): void {
    this.recordStage({
      stage: "revision",
      status: "ok",
      durationMs: args.durationMs,
      usage: args.usage,
      providerCalls: 1,
      details: { attempt: args.attempt },
    });
  }

  recordSemanticReviewFailed(meta: {
    reviewAttempts: number;
    revisionAttempts: number;
    revised: boolean;
    problemTypes: string[];
    materialFindingCount: number;
    secondaryFindingCount: number;
    outcome: string;
  }): void {
    this.recordStage({
      stage: "semantic_review",
      status: "error",
      durationMs: null,
      errorCode: "answer_review_failed",
      details: {
        reviewAttempts: meta.reviewAttempts,
        revisionAttempts: meta.revisionAttempts,
        revised: meta.revised,
        problemTypes: meta.problemTypes,
        materialFindingCount: meta.materialFindingCount,
        secondaryFindingCount: meta.secondaryFindingCount,
        outcome: meta.outcome,
      },
    });
  }

  recordStageError(
    stage: TraceStageName,
    error: unknown,
    durationMs: number | null,
  ): void {
    this.recordStage({
      stage,
      status: isAbortError(error) ? "cancelled" : "error",
      durationMs,
      errorCode: safeErrorCode(error),
      usage: toTraceTokenUsage(null),
    });
  }

  endSuccess(args: {
    answerStatus: string;
    citedChunkIds: string[];
    answerReviewOutcome?: string;
  }): void {
    this.finish({
      outcome: "success",
      answerStatus: args.answerStatus,
      citedChunkIds: args.citedChunkIds,
      answerReviewOutcome: args.answerReviewOutcome,
      unresolvedReferenceCount: this.unresolvedReferenceCount,
      index: this.indexIdentity,
    });
  }

  endFromError(error: unknown): void {
    const outcome: TraceOutcome = isAbortError(error) ? "cancelled" : "error";
    this.finish({
      outcome,
      errorCode: safeErrorCode(error),
      errorStage: inferErrorStage(error),
      unresolvedReferenceCount: this.unresolvedReferenceCount,
      index: this.indexIdentity,
    });
  }

  private finish(partial: Omit<TraceEndPayload, "finishedAt" | "totalDurationMs" | "scopeNote">): void {
    if (this.ended) return;
    this.ended = true;
    void this.emit({
      schemaVersion: TRACE_SCHEMA_VERSION,
      requestId: this.requestId,
      type: "end",
      seq: this.nextSeq(),
      at: new Date().toISOString(),
      payload: {
        ...partial,
        finishedAt: new Date().toISOString(),
        totalDurationMs: performance.now() - this.wallStarted,
        scopeNote: TRACE_SCOPE_NOTE,
      },
    });
  }

  private nextSeq(): number {
    this.seq += 1;
    return this.seq;
  }

  private async emit(event: TraceEvent): Promise<void> {
    if (!this.enabled) return;
    try {
      await this.writer.append(event);
    } catch {
      // Trace write failures must never fail a successful ask.
    }
  }
}

function scoreTypeForMode(mode: string): string {
  if (mode === "vector") return "cosine";
  if (mode === "lexical") return "bm25";
  if (mode === "hybrid") return "rrf";
  return "unknown";
}

function sanitizeReason(reason: string): string {
  const lower = reason.toLowerCase();
  if (lower.includes("budget")) return "budget";
  if (lower.includes("omit")) return "omitted";
  return "other";
}
