import type { ModelGenerationPayload } from "../ask-types";
import { assembleAnswerFromParts } from "../validate-answer";
import { isAnswerReviewEnabled } from "./config";
import { reviewAnswerDraft } from "./review";
import { reviseAnswerDraft } from "./revise";
import {
  AnswerReviewFailedError,
  AnswerReviewSystemError,
  MAX_REVISION_ATTEMPTS,
  MAX_REVIEW_ATTEMPTS,
  type AnswerReviewMeta,
  type AnswerReviewPipelineResult,
  type ReviewDraftInput,
  type ReviewFinding,
  type ReviewProblemType,
} from "./types";
import { shouldAttemptRevision } from "./validate-review";

export interface AnswerReviewPipelineOptions {
  /** Override env toggle. */
  enabled?: boolean;
  model?: string;
  apiKey?: string;
  signal?: AbortSignal;
  requestId?: string;
  reviewFn?: typeof reviewAnswerDraft;
  reviseFn?: typeof reviseAnswerDraft;
  onReview?: (args: {
    attempt: number;
    decision: string;
    materialCount: number;
    secondaryCount: number;
    problemTypes: ReviewProblemType[];
    durationMs: number;
    usage?: {
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
    };
  }) => void;
  onRevision?: (args: {
    attempt: number;
    durationMs: number;
    usage?: {
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
    };
  }) => void;
}

function emptyMeta(enabled: boolean): AnswerReviewMeta {
  return {
    enabled,
    outcome: enabled ? "failed_after_revision" : "skipped_disabled",
    reviewAttempts: 0,
    revisionAttempts: 0,
    revised: false,
    problemTypes: [],
    materialFindingCount: 0,
    secondaryFindingCount: 0,
    finalDecision: "n_a",
    reviewMs: [],
    usage: {},
  };
}

function accumulateFindings(
  meta: AnswerReviewMeta,
  findings: readonly ReviewFinding[],
): void {
  for (const f of findings) {
    if (!meta.problemTypes.includes(f.problemType)) {
      meta.problemTypes.push(f.problemType);
    }
    if (f.severity === "material") meta.materialFindingCount += 1;
    else meta.secondaryFindingCount += 1;
  }
}

function addUsage(
  meta: AnswerReviewMeta,
  kind: "review" | "revision",
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  },
): void {
  if (!usage) return;
  meta.usage ??= {};
  if (kind === "review") {
    meta.usage.reviewPromptTokens =
      (meta.usage.reviewPromptTokens ?? 0) + (usage.promptTokens ?? 0);
    meta.usage.reviewCompletionTokens =
      (meta.usage.reviewCompletionTokens ?? 0) + (usage.completionTokens ?? 0);
    meta.usage.reviewTotalTokens =
      (meta.usage.reviewTotalTokens ?? 0) + (usage.totalTokens ?? 0);
  } else {
    meta.usage.revisionPromptTokens =
      (meta.usage.revisionPromptTokens ?? 0) + (usage.promptTokens ?? 0);
    meta.usage.revisionCompletionTokens =
      (meta.usage.revisionCompletionTokens ?? 0) +
      (usage.completionTokens ?? 0);
    meta.usage.revisionTotalTokens =
      (meta.usage.revisionTotalTokens ?? 0) + (usage.totalTokens ?? 0);
  }
}

/**
 * After initial generation: up to 2 reviews and 1 revision. No further loops.
 * Does not mutate retrieval/context. Validates revised drafts via assembleAnswerFromParts.
 */
export async function runAnswerReviewPipeline(
  input: ReviewDraftInput,
  options: AnswerReviewPipelineOptions = {},
): Promise<AnswerReviewPipelineResult> {
  const enabled = isAnswerReviewEnabled(options.enabled);
  if (!enabled) {
    return {
      payload: input.draft,
      meta: { ...emptyMeta(false), outcome: "skipped_disabled" },
    };
  }

  const reviewFn = options.reviewFn ?? reviewAnswerDraft;
  const reviseFn = options.reviseFn ?? reviseAnswerDraft;
  const meta = emptyMeta(true);
  let draft: ModelGenerationPayload = input.draft;

  const runReview = async (attempt: number) => {
    if (meta.reviewAttempts >= MAX_REVIEW_ATTEMPTS) {
      throw new AnswerReviewFailedError(
        "Answer review attempt budget exhausted.",
        meta,
        options.requestId,
      );
    }
    meta.reviewAttempts += 1;
    const result = await reviewFn(
      { ...input, draft },
      {
        model: options.model,
        apiKey: options.apiKey,
        signal: options.signal,
      },
    );
    meta.reviewMs.push(result.latencyMs);
    addUsage(meta, "review", result.usage);
    accumulateFindings(meta, result.payload.findings);
    meta.finalDecision = result.payload.decision;
    options.onReview?.({
      attempt,
      decision: result.payload.decision,
      materialCount: result.payload.findings.filter((f) => f.severity === "material")
        .length,
      secondaryCount: result.payload.findings.filter(
        (f) => f.severity === "secondary",
      ).length,
      problemTypes: result.payload.findings.map((f) => f.problemType),
      durationMs: result.latencyMs,
      usage: result.usage,
    });
    return result.payload;
  };

  // Review #1
  let review = await runReview(1);
  if (!shouldAttemptRevision(review, draft)) {
    meta.outcome = "passed_first_review";
    meta.finalDecision = "pass";
    return { payload: draft, meta };
  }

  // Single revision
  if (meta.revisionAttempts >= MAX_REVISION_ATTEMPTS) {
    throw new AnswerReviewFailedError(
      "Answer revision budget exhausted.",
      meta,
      options.requestId,
    );
  }
  meta.revisionAttempts += 1;
  const revised = await reviseFn(
    { ...input, draft, findings: review.findings },
    {
      model: options.model,
      apiKey: options.apiKey,
      signal: options.signal,
    },
  );
  meta.revised = true;
  meta.revisionMs = revised.latencyMs;
  addUsage(meta, "revision", revised.usage);
  options.onRevision?.({
    attempt: 1,
    durationMs: revised.latencyMs,
    usage: revised.usage,
  });

  // Structural validation of revision (chunk ids) — technical, not semantic.
  try {
    assembleAnswerFromParts(revised.payload, input.contextChunks);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new AnswerReviewSystemError(
      `Revised draft failed structure/citation validation: ${message}`,
    );
  }
  draft = revised.payload;

  // Review #2 (final)
  review = await runReview(2);
  if (!shouldAttemptRevision(review, draft)) {
    meta.outcome = "passed_after_revision";
    meta.finalDecision = "pass";
    return { payload: draft, meta };
  }

  meta.outcome = "failed_after_revision";
  throw new AnswerReviewFailedError(
    "Answer draft still failed material review after one revision.",
    meta,
    options.requestId,
  );
}
