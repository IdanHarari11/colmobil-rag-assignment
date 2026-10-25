import { HE_INSUFFICIENT_EVIDENCE } from "@/lib/user-facing-he";
import type { RetrievalHit } from "./types";
import type { ApplicabilitySummary } from "./document-relations/types";
import type { AnswerReviewMeta } from "./answer-review/types";

export type AnswerStatus =
  | "answered"
  | "clarification_needed"
  | "insufficient_evidence";

export type ContextOrigin = "retrieved" | "expanded" | "linked";

export interface ContextChunk {
  chunkId: string;
  documentId: string;
  relativePath: string;
  text: string;
  embeddingText?: string;
  documentTitle?: string;
  sectionPath?: string[];
  pages?: number[];
  warnings: string[];
  origin: ContextOrigin;
  /** Estimated tokens of this chunk's packed context block (heuristic). */
  estimatedTokens: number;
}

export interface ContextBuildResult {
  contextChunks: ContextChunk[];
  /** Retrieved hits that did not fit the budget (should be rare). */
  omittedRetrieved: Array<{ chunkId: string; reason: string }>;
  /** Sibling expansions skipped due to budget. */
  omittedExpansions: Array<{ chunkId: string; reason: string }>;
  estimatedContextTokens: number;
  budgetTokens: number;
  tokenEstimateMethod: string;
  contextComplete: boolean;
  /** Stage 4 applicability / version summary when enrichment ran. */
  applicability?: ApplicabilitySummary;
  linkedChunkIds?: string[];
  enrichmentOmissions?: Array<{ chunkId: string; reasonCode: string }>;
  /** Original Hybrid top-K ids (Recall@5 must not count linked expansions). */
  hybridTopKChunkIds?: string[];
}

/** One grounded fragment: text plus the chunkIds that support it. */
export interface AnswerPart {
  text: string;
  sourceChunkIds: string[];
}

export interface Citation {
  chunkId: string;
  /** Texts of answer parts that cite this chunk (server-derived). */
  claims: string[];
}

/**
 * Raw model generation payload (answerParts only — no free-form citation claims).
 * Status includes clarification_needed decided at generation time (with context).
 */
export interface ModelGenerationPayload {
  status: AnswerStatus;
  answerParts: AnswerPart[];
}

export interface AnswerSource {
  chunkId: string;
  documentId: string;
  relativePath: string;
  fileName: string;
  documentTitle?: string;
  /**
   * Verified version from document-relations manifest when present.
   * Optional for backward compatibility with older stored messages.
   */
  versionLabel?: string;
  sectionPath?: string[];
  pages?: number[];
  claims: string[];
  origin: ContextOrigin;
}

/** Neutral server copy for insufficient_evidence (Hebrew, user-facing). */
export const NEUTRAL_INSUFFICIENT_ANSWER = HE_INSUFFICIENT_EVIDENCE;

/** Stage 2 rewriting diagnostics (CLI/eval only — not shown in chat UI). */
export interface AskRewriteDiagnostics {
  originalQuestion: string;
  standaloneQuestion: string;
  unresolvedReferences: string[];
  model: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  rewriteMs: number;
}

export interface AskResult {
  /** Server-assigned id for this ask invocation (tracing / support). */
  requestId: string;
  /** Original user question for this turn (not the rewritten form). */
  question: string;
  /** Question used for retrieval (equals question when no history). */
  standaloneQuestion: string;
  unresolvedReferences: string[];
  /** Present only when history triggered query rewriting. */
  rewrite?: AskRewriteDiagnostics;
  status: AnswerStatus;
  answer: string;
  /** Server-assembled parts that produced answer + citations. */
  answerParts: AnswerPart[];
  citations: Citation[];
  sources: AnswerSource[];
  retrievedChunks: RetrievalHit[];
  contextChunks: ContextChunk[];
  contextMeta: {
    budgetTokens: number;
    estimatedContextTokens: number;
    tokenEstimateMethod: string;
    contextComplete: boolean;
    omittedRetrieved: ContextBuildResult["omittedRetrieved"];
    omittedExpansions: ContextBuildResult["omittedExpansions"];
    applicability?: ApplicabilitySummary;
    linkedChunkIds?: string[];
    enrichmentOmissions?: Array<{ chunkId: string; reasonCode: string }>;
    hybridTopKChunkIds?: string[];
    /**
     * Deterministic day counts from user-stated absolute dates (not corpus).
     * Present when extraction found events, spans, or missing-clock notes.
     */
    computedTemporalFacts?: import("./temporal").ComputedTemporalFacts;
  };
  validation: {
    structureOk: boolean;
    citationsOk: boolean;
    invalidCitationIds: string[];
  };
  retrievalMode: string;
  generationModel: string;
  embeddingModel: string;
  usage?: {
    embeddingPromptTokens?: number;
    generationPromptTokens?: number;
    generationCompletionTokens?: number;
    generationTotalTokens?: number;
    rewritePromptTokens?: number;
    rewriteCompletionTokens?: number;
    rewriteTotalTokens?: number;
    reviewPromptTokens?: number;
    reviewCompletionTokens?: number;
    reviewTotalTokens?: number;
    revisionPromptTokens?: number;
    revisionCompletionTokens?: number;
    revisionTotalTokens?: number;
  };
  timingsMs: {
    rewriteMs?: number;
    retrieveMs: number;
    contextMs: number;
    generationMs: number;
    totalMs: number;
    /** Sum of semantic review call(s); omitted when review disabled. */
    reviewMs?: number;
    revisionMs?: number;
  };
  /** Stage 5 semantic review metadata (absent when disabled). */
  answerReview?: AnswerReviewMeta;
}

export class GenerationSystemError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GenerationSystemError";
  }
}
