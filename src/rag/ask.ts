import { DEFAULT_CONTEXT_BUDGET_TOKENS } from "./context-builder";
import {
  buildEnrichedGenerationContext,
  getValidatedManifest,
} from "./document-relations";
import { generateGroundedAnswer, getGenerationModel } from "./generate";
import {
  buildComputedTemporalFacts,
  userTextsForTemporalExtraction,
} from "./temporal";
import {
  applyHistoryWindow,
  HISTORY_MAX_TOTAL_CHARS,
  HISTORY_MAX_TURNS,
  parseAndValidateHistory,
  type ChatHistoryMessage,
} from "./history";
import { loadValidatedIndex } from "./index-store";
import { defaultChunksPath, defaultIndexPath } from "./paths";
import { retrieve, type RetrieveDependencies } from "./retrieve";
import {
  rewriteQuery,
  RewriteSystemError,
  type RewriteQueryResult,
} from "./rewrite-query";
import type { AskResult } from "./ask-types";
import { GenerationSystemError } from "./ask-types";
import {
  AnswerReviewFailedError,
  AnswerReviewSystemError,
  isAnswerReviewEnabled,
  runAnswerReviewPipeline,
  type AnswerReviewPipelineOptions,
} from "./answer-review";
import { assembleAnswerFromParts } from "./validate-answer";
import type { LocalIndex, RetrieveMode } from "./types";
import { createRequestId } from "./trace/request-id";
import { isAbortError } from "./trace/safe-error";
import { AskTraceSession, type TraceSource } from "./trace/session";
import type { TraceWriter } from "./trace/writer";
import { toTraceTokenUsage } from "./trace/usage";

export interface AskOptions {
  topK?: number;
  mode?: RetrieveMode;
  contextBudgetTokens?: number;
  generationModel?: string;
  indexPath?: string;
  chunksPath?: string;
  /**
   * Prior turns only (user/assistant). The current question is separate.
   * When empty/omitted, the existing no-rewrite path is used.
   */
  history?: readonly ChatHistoryMessage[] | unknown;
  /** Optional abort for rewrite / retrieve / generate steps. */
  signal?: AbortSignal;
  /** Optional fixed id (tests). Otherwise created server-side. */
  requestId?: string;
  /** Where this ask was invoked from (trace metadata only). */
  traceSource?: TraceSource;
  /** Inject writer (tests) or disable with enabled=false via deps. */
  traceWriter?: TraceWriter;
  /** When false, skip JSONL writes (requestId still assigned). */
  traceEnabled?: boolean;
  /**
   * Stage 5 semantic draft review. Overrides ANSWER_REVIEW_ENABLED when set.
   * Draft is never shown to the user until the review path finishes.
   */
  answerReviewEnabled?: boolean;
}

export interface AskDependencies extends RetrieveDependencies {
  index?: LocalIndex;
  generate?: typeof generateGroundedAnswer;
  rewrite?: typeof rewriteQuery;
  /** Injected validated manifest (tests). */
  documentRelationsManifest?: Awaited<
    ReturnType<typeof getValidatedManifest>
  >;
  reviewPipeline?: typeof runAnswerReviewPipeline;
  reviewPipelineOptions?: Omit<
    AnswerReviewPipelineOptions,
    "enabled" | "model" | "signal" | "requestId"
  >;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("Request aborted", "AbortError");
  }
}

/**
 * End-to-end grounded ask:
 * optional history → rewrite → Hybrid retrieve → context → generate answerParts
 * → optional semantic review (+ one revision) → assemble for the user.
 * Without history: no rewrite model call.
 * Tracing records stage metadata; drafts are not logged as free text.
 */
export async function ask(
  question: string,
  options: AskOptions = {},
  deps: AskDependencies = {},
): Promise<AskResult> {
  const trimmed = question.trim();
  if (!trimmed) {
    throw new Error("ask() requires a non-empty question");
  }

  const mode = options.mode ?? "hybrid";
  const topK = options.topK ?? 5;
  const model = options.generationModel ?? getGenerationModel();
  const signal = options.signal;
  const totalStarted = performance.now();
  const requestId = options.requestId ?? createRequestId();

  const rawHistory = parseAndValidateHistory(options.history);
  const history = applyHistoryWindow(rawHistory);
  const useRewrite = history.length > 0;

  const trace = new AskTraceSession({
    requestId,
    source: options.traceSource ?? "unknown",
    writer: options.traceWriter,
    enabled: options.traceEnabled !== false,
    historyPresent: useRewrite,
    historyMessageCount: history.length,
    config: {
      retrievalMode: mode,
      topK,
      contextBudgetTokens:
        options.contextBudgetTokens ?? DEFAULT_CONTEXT_BUDGET_TOKENS,
      generationModel: model,
      historyWindowMaxTurns: HISTORY_MAX_TURNS,
      historyWindowMaxTotalChars: HISTORY_MAX_TOTAL_CHARS,
      answerReviewEnabled: isAnswerReviewEnabled(options.answerReviewEnabled),
    },
  });

  try {
    throwIfAborted(signal);

    let standaloneQuestion = trimmed;
    let unresolvedReferences: string[] = [];
    let rewriteResult: RewriteQueryResult | undefined;
    let rewriteMs: number | undefined;

    if (useRewrite) {
      const rewriteFn = deps.rewrite ?? rewriteQuery;
      const rewriteStarted = performance.now();
      try {
        rewriteResult = await rewriteFn({
          question: trimmed,
          history,
          model,
          signal,
        });
      } catch (error) {
        trace.recordStageError(
          "rewrite",
          error,
          performance.now() - rewriteStarted,
        );
        if (isAbortError(error)) throw error;
        if (error instanceof RewriteSystemError) throw error;
        if (error instanceof GenerationSystemError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        throw new RewriteSystemError(`Query rewrite failed: ${message}`);
      }
      standaloneQuestion = rewriteResult.standaloneQuestion;
      unresolvedReferences = rewriteResult.unresolvedReferences;
      rewriteMs = rewriteResult.latencyMs;
      trace.recordRewriteOk({
        durationMs: rewriteMs,
        usage: toTraceTokenUsage(rewriteResult.usage),
        unresolvedReferenceCount: unresolvedReferences.length,
        model: rewriteResult.model,
      });
    } else {
      trace.recordSkipped("rewrite", "no_history");
    }

    throwIfAborted(signal);

    const index =
      deps.index ??
      (await loadValidatedIndex({
        chunksPath: options.chunksPath ?? deps.chunksPath ?? defaultChunksPath(),
        indexPath: options.indexPath ?? deps.indexPath ?? defaultIndexPath(),
        config: deps.embedder?.config,
      }));
    trace.setIndex(index);

    const retrieveStarted = performance.now();
    let retrieval;
    try {
      retrieval = await retrieve(
        standaloneQuestion,
        { topK, mode },
        { ...deps, index },
      );
    } catch (error) {
      trace.recordStageError(
        "retrieval",
        error,
        performance.now() - retrieveStarted,
      );
      throw error;
    }
    const retrieveMs = performance.now() - retrieveStarted;
    trace.recordRetrievalOk({
      durationMs: retrieveMs,
      embeddingMs: retrieval.timingsMs.questionEmbeddingMs,
      localSearchMs: retrieval.timingsMs.localSearchMs,
      embeddingUsage: toTraceTokenUsage(retrieval.usage),
      mode: retrieval.mode,
      hits: retrieval.hits,
    });

    throwIfAborted(signal);

    const contextStarted = performance.now();
    const manifest =
      deps.documentRelationsManifest ?? (await getValidatedManifest(index));
    const context = buildEnrichedGenerationContext(retrieval.hits, index, {
      budgetTokens: options.contextBudgetTokens ?? DEFAULT_CONTEXT_BUDGET_TOKENS,
      questionTexts: [trimmed, standaloneQuestion],
      manifest,
    });
    const contextMs = performance.now() - contextStarted;
    trace.recordContextOk({ durationMs: contextMs, context });

    throwIfAborted(signal);

    const computedTemporalFacts = buildComputedTemporalFacts(
      userTextsForTemporalExtraction({ question: trimmed, history }),
    );
    const temporalForPrompt =
      computedTemporalFacts.events.length > 0 ||
      computedTemporalFacts.daySpans.length > 0 ||
      computedTemporalFacts.missingOrUncertain.length > 0
        ? computedTemporalFacts
        : undefined;

    const generateFn = deps.generate ?? generateGroundedAnswer;
    let generation;
    const generationStarted = performance.now();
    try {
      generation = await generateFn({
        question: trimmed,
        standaloneQuestion,
        unresolvedReferences,
        contextChunks: context.contextChunks,
        applicabilitySummary: context.applicability,
        computedTemporalFacts: temporalForPrompt,
        model,
        signal,
      });
    } catch (error) {
      trace.recordStageError(
        "generation",
        error,
        performance.now() - generationStarted,
      );
      if (isAbortError(error)) throw error;
      if (error instanceof GenerationSystemError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new GenerationSystemError(message);
    }
    trace.recordGenerationOk({
      durationMs: generation.latencyMs,
      usage: toTraceTokenUsage(generation.usage),
      model: generation.model,
    });

    // Structure/chunkId gate on the initial draft (not semantic faithfulness).
    const validationStarted = performance.now();
    try {
      assembleAnswerFromParts(generation.payload, context.contextChunks);
    } catch (error) {
      trace.recordStageError(
        "validation",
        error,
        performance.now() - validationStarted,
      );
      throw error;
    }
    trace.recordValidationOk({
      durationMs: performance.now() - validationStarted,
      structureOk: true,
      citationsOk: true,
      invalidCitationIds: [],
    });

    throwIfAborted(signal);

    const reviewEnabled = isAnswerReviewEnabled(options.answerReviewEnabled);
    const pipeline = deps.reviewPipeline ?? runAnswerReviewPipeline;
    let finalPayload = generation.payload;
    let answerReviewMeta: AskResult["answerReview"];

    try {
      const reviewed = await pipeline(
        {
          question: trimmed,
          standaloneQuestion,
          unresolvedReferences,
          history,
          draft: generation.payload,
          contextChunks: context.contextChunks,
          applicabilitySummary: context.applicability,
        },
        {
          enabled: reviewEnabled,
          model,
          signal,
          requestId,
          ...deps.reviewPipelineOptions,
          onReview: (args) => {
            trace.recordSemanticReviewOk({
              attempt: args.attempt,
              durationMs: args.durationMs,
              usage: toTraceTokenUsage(args.usage),
              decision: args.decision,
              materialFindingCount: args.materialCount,
              secondaryFindingCount: args.secondaryCount,
              problemTypes: args.problemTypes,
            });
            deps.reviewPipelineOptions?.onReview?.(args);
          },
          onRevision: (args) => {
            trace.recordRevisionOk({
              attempt: args.attempt,
              durationMs: args.durationMs,
              usage: toTraceTokenUsage(args.usage),
            });
            deps.reviewPipelineOptions?.onRevision?.(args);
          },
        },
      );
      finalPayload = reviewed.payload;
      answerReviewMeta = reviewed.meta;
      if (!reviewEnabled) {
        trace.recordSkipped("semantic_review", "review_disabled");
      }
    } catch (error) {
      if (isAbortError(error)) {
        trace.recordStageError("semantic_review", error, null);
        throw error;
      }
      if (error instanceof AnswerReviewFailedError) {
        trace.recordSemanticReviewFailed(error.meta);
        throw error;
      }
      if (error instanceof AnswerReviewSystemError) {
        trace.recordStageError("semantic_review", error, null);
        throw error;
      }
      trace.recordStageError("semantic_review", error, null);
      throw error;
    }

    const assembleStarted = performance.now();
    let assembled;
    try {
      assembled = assembleAnswerFromParts(
        finalPayload,
        context.contextChunks,
      );
    } catch (error) {
      trace.recordStageError(
        "validation",
        error,
        performance.now() - assembleStarted,
      );
      throw error;
    }
    // Second structure pass after revision — still not semantic review.
    if (answerReviewMeta?.revised) {
      trace.recordValidationOk({
        durationMs: performance.now() - assembleStarted,
        structureOk: true,
        citationsOk: assembled.citationsOk,
        invalidCitationIds: assembled.invalidCitationIds,
        kind: "structure_and_chunk_ids_post_revision",
      });
    }

    const reviewMsSum =
      answerReviewMeta && answerReviewMeta.reviewMs.length > 0
        ? answerReviewMeta.reviewMs.reduce((a, b) => a + b, 0)
        : undefined;

    const result: AskResult = {
      requestId,
      question: trimmed,
      standaloneQuestion,
      unresolvedReferences,
      ...(rewriteResult
        ? {
            rewrite: {
              originalQuestion: trimmed,
              standaloneQuestion: rewriteResult.standaloneQuestion,
              unresolvedReferences: rewriteResult.unresolvedReferences,
              model: rewriteResult.model,
              usage: rewriteResult.usage,
              rewriteMs: rewriteResult.latencyMs,
            },
          }
        : {}),
      status: assembled.status,
      answer: assembled.answer,
      answerParts: assembled.answerParts,
      citations: assembled.citations,
      sources: assembled.sources,
      retrievedChunks: retrieval.hits,
      contextChunks: context.contextChunks,
      contextMeta: {
        budgetTokens: context.budgetTokens,
        estimatedContextTokens: context.estimatedContextTokens,
        tokenEstimateMethod: context.tokenEstimateMethod,
        contextComplete: context.contextComplete,
        omittedRetrieved: context.omittedRetrieved,
        omittedExpansions: context.omittedExpansions,
        applicability: context.applicability,
        linkedChunkIds: context.linkedChunkIds,
        enrichmentOmissions: context.enrichmentOmissions,
        hybridTopKChunkIds: context.hybridTopKChunkIds,
        computedTemporalFacts: temporalForPrompt,
      },
      validation: {
        structureOk: true,
        citationsOk: assembled.citationsOk,
        invalidCitationIds: assembled.invalidCitationIds,
      },
      retrievalMode: retrieval.mode,
      generationModel: generation.modelReturned,
      embeddingModel: retrieval.model,
      usage: {
        embeddingPromptTokens: retrieval.usage?.promptTokens,
        generationPromptTokens: generation.usage?.promptTokens,
        generationCompletionTokens: generation.usage?.completionTokens,
        generationTotalTokens: generation.usage?.totalTokens,
        rewritePromptTokens: rewriteResult?.usage?.promptTokens,
        rewriteCompletionTokens: rewriteResult?.usage?.completionTokens,
        rewriteTotalTokens: rewriteResult?.usage?.totalTokens,
        reviewPromptTokens: answerReviewMeta?.usage?.reviewPromptTokens,
        reviewCompletionTokens: answerReviewMeta?.usage?.reviewCompletionTokens,
        reviewTotalTokens: answerReviewMeta?.usage?.reviewTotalTokens,
        revisionPromptTokens: answerReviewMeta?.usage?.revisionPromptTokens,
        revisionCompletionTokens:
          answerReviewMeta?.usage?.revisionCompletionTokens,
        revisionTotalTokens: answerReviewMeta?.usage?.revisionTotalTokens,
      },
      timingsMs: {
        ...(rewriteMs !== undefined ? { rewriteMs } : {}),
        retrieveMs,
        contextMs,
        generationMs: generation.latencyMs,
        ...(reviewMsSum !== undefined ? { reviewMs: reviewMsSum } : {}),
        ...(answerReviewMeta?.revisionMs !== undefined
          ? { revisionMs: answerReviewMeta.revisionMs }
          : {}),
        totalMs: performance.now() - totalStarted,
      },
      ...(answerReviewMeta ? { answerReview: answerReviewMeta } : {}),
    };

    trace.endSuccess({
      answerStatus: result.status,
      citedChunkIds: result.sources.map((s) => s.chunkId),
      answerReviewOutcome: answerReviewMeta?.outcome,
    });
    return result;
  } catch (error) {
    trace.endFromError(error);
    throw error;
  }
}
