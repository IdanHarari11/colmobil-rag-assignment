/**
 * Stage 5 — semantic draft review (claim support / completeness).
 * The reviewer is fallible: findings guide revision, they are not absolute truth.
 */

import type {
  AnswerPart,
  AnswerStatus,
  ContextChunk,
  ModelGenerationPayload,
} from "../ask-types";
import type { ApplicabilitySummary } from "../document-relations/types";
import type { ChatHistoryMessage } from "../history";

export const REVIEW_PROBLEM_TYPES = [
  "unsupported_claim",
  "incorrect_citation",
  "contradiction",
  "missing_material_condition",
  "wrong_applicability",
  "unjustified_assumption",
  "inappropriate_response_status",
] as const;

export type ReviewProblemType = (typeof REVIEW_PROBLEM_TYPES)[number];

export type ReviewSeverity = "material" | "secondary";

export type ReviewDecision = "pass" | "revise";

export interface ReviewFinding {
  problemType: ReviewProblemType;
  /** Index into draft answerParts, or null when status/overall. */
  affectedPartIndex: number | null;
  sourceChunkIds: string[];
  explanation: string;
  requiredFix: string;
  severity: ReviewSeverity;
}

export interface ReviewResultPayload {
  decision: ReviewDecision;
  findings: ReviewFinding[];
}

export interface ReviewCallResult {
  payload: ReviewResultPayload;
  model: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    cachedInputTokens?: number;
  };
  latencyMs: number;
  rawText: string;
}

export interface ReviewDraftInput {
  question: string;
  standaloneQuestion: string;
  unresolvedReferences: readonly string[];
  /** Prior turns only — for reference resolution, not as insurance facts. */
  history: readonly ChatHistoryMessage[];
  draft: ModelGenerationPayload;
  contextChunks: ContextChunk[];
  applicabilitySummary?: ApplicabilitySummary;
}

export interface ReviseDraftInput extends ReviewDraftInput {
  findings: readonly ReviewFinding[];
}

/** Max provider calls after initial generation: 2 reviews + 1 revision. */
export const MAX_REVIEW_ATTEMPTS = 2;
export const MAX_REVISION_ATTEMPTS = 1;

export type AnswerReviewOutcome =
  | "passed_first_review"
  | "passed_after_revision"
  | "failed_after_revision"
  | "skipped_disabled";

export interface AnswerReviewMeta {
  enabled: boolean;
  outcome: AnswerReviewOutcome;
  reviewAttempts: number;
  revisionAttempts: number;
  revised: boolean;
  /** Problem types seen across reviews (no free text). */
  problemTypes: ReviewProblemType[];
  materialFindingCount: number;
  secondaryFindingCount: number;
  finalDecision: ReviewDecision | "n_a";
  reviewMs: number[];
  revisionMs?: number;
  usage?: {
    reviewPromptTokens?: number;
    reviewCompletionTokens?: number;
    reviewTotalTokens?: number;
    revisionPromptTokens?: number;
    revisionCompletionTokens?: number;
    revisionTotalTokens?: number;
  };
}

export interface AnswerReviewPipelineResult {
  payload: ModelGenerationPayload;
  meta: AnswerReviewMeta;
}

/** Semantic review exhausted budget without a passing draft. */
export class AnswerReviewFailedError extends Error {
  readonly code = "answer_review_failed" as const;
  readonly requestId?: string;
  readonly meta: AnswerReviewMeta;

  constructor(message: string, meta: AnswerReviewMeta, requestId?: string) {
    super(message);
    this.name = "AnswerReviewFailedError";
    this.meta = meta;
    this.requestId = requestId;
  }
}

/** Reviewer/reviser API or invalid structured output (technical, not “answer wrong”). */
export class AnswerReviewSystemError extends Error {
  readonly code = "answer_review_error" as const;

  constructor(message: string) {
    super(message);
    this.name = "AnswerReviewSystemError";
  }
}

export function isReviewProblemType(value: unknown): value is ReviewProblemType {
  return (
    typeof value === "string" &&
    (REVIEW_PROBLEM_TYPES as readonly string[]).includes(value)
  );
}

export function draftPartCount(draft: {
  answerParts: AnswerPart[];
  status: AnswerStatus;
}): number {
  return draft.answerParts.length;
}
