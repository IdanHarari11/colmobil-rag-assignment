import { describe, expect, it } from "vitest";
import type { ReviewCallResult } from "./types";
import {
  AnswerReviewFailedError,
  AnswerReviewSystemError,
} from "./types";
import { runAnswerReviewPipeline } from "./pipeline";
import {
  FIXTURE_CONTEXTS,
  FIXTURE_DRAFT_GOOD,
  FIXTURE_DRAFT_WRONG_AMOUNT,
  FIXTURE_REVIEW_MATERIAL_AMOUNT,
  FIXTURE_REVIEW_PASS,
  FIXTURE_REVIEW_SECONDARY_ONLY,
  FIXTURE_REVISED_GOOD,
  FIXTURE_REVISED_STILL_BAD,
} from "./fixtures";

function reviewResult(
  payload: ReviewCallResult["payload"],
): ReviewCallResult {
  return {
    payload,
    model: "mock",
    rawText: "{}",
    latencyMs: 5,
    usage: { promptTokens: 3, completionTokens: 2, totalTokens: 5 },
  };
}

const baseInput = {
  question: "מה ההשתתפות במוסך הסדר?",
  standaloneQuestion: "מה ההשתתפות במוסך הסדר?",
  unresolvedReferences: [] as string[],
  history: [] as const,
  contextChunks: FIXTURE_CONTEXTS,
};

describe("runAnswerReviewPipeline (deterministic fixtures)", () => {
  it("passes a good draft on first review without revision", async () => {
    const result = await runAnswerReviewPipeline(
      { ...baseInput, draft: FIXTURE_DRAFT_GOOD },
      {
        enabled: true,
        reviewFn: async () => reviewResult(FIXTURE_REVIEW_PASS),
        reviseFn: async () => {
          throw new Error("revise must not run");
        },
      },
    );
    expect(result.meta.outcome).toBe("passed_first_review");
    expect(result.meta.reviewAttempts).toBe(1);
    expect(result.meta.revisionAttempts).toBe(0);
    expect(result.payload).toEqual(FIXTURE_DRAFT_GOOD);
  });

  it("does not revise for secondary-only findings", async () => {
    const result = await runAnswerReviewPipeline(
      { ...baseInput, draft: FIXTURE_DRAFT_GOOD },
      {
        enabled: true,
        reviewFn: async () => reviewResult(FIXTURE_REVIEW_SECONDARY_ONLY),
        reviseFn: async () => {
          throw new Error("revise must not run");
        },
      },
    );
    expect(result.meta.outcome).toBe("passed_first_review");
    expect(result.meta.revisionAttempts).toBe(0);
  });

  it("revises once then passes on second review", async () => {
    let reviews = 0;
    const result = await runAnswerReviewPipeline(
      { ...baseInput, draft: FIXTURE_DRAFT_WRONG_AMOUNT },
      {
        enabled: true,
        reviewFn: async () => {
          reviews += 1;
          return reviewResult(
            reviews === 1
              ? FIXTURE_REVIEW_MATERIAL_AMOUNT
              : FIXTURE_REVIEW_PASS,
          );
        },
        reviseFn: async () => ({
          payload: FIXTURE_REVISED_GOOD,
          rawText: "{}",
          model: "mock",
          modelRequested: "mock",
          modelReturned: "mock",
          samplingProfile: { kind: "classic_sampling", temperature: 0 },
          latencyMs: 7,
          usage: { promptTokens: 4, completionTokens: 4, totalTokens: 8 },
        }),
      },
    );
    expect(result.meta.outcome).toBe("passed_after_revision");
    expect(result.meta.reviewAttempts).toBe(2);
    expect(result.meta.revisionAttempts).toBe(1);
    expect(result.meta.revised).toBe(true);
    expect(result.payload.answerParts[0]?.text).toContain("950");
  });

  it("fails with AnswerReviewFailedError when revision still fails (no loop)", async () => {
    let reviews = 0;
    await expect(
      runAnswerReviewPipeline(
        { ...baseInput, draft: FIXTURE_DRAFT_WRONG_AMOUNT },
        {
          enabled: true,
          reviewFn: async () => {
            reviews += 1;
            return reviewResult(FIXTURE_REVIEW_MATERIAL_AMOUNT);
          },
          reviseFn: async () => ({
            payload: FIXTURE_REVISED_STILL_BAD,
            rawText: "{}",
            model: "mock",
          modelRequested: "mock",
          modelReturned: "mock",
          samplingProfile: { kind: "classic_sampling", temperature: 0 },
            latencyMs: 7,
          }),
        },
      ),
    ).rejects.toBeInstanceOf(AnswerReviewFailedError);
    expect(reviews).toBe(2);
  });

  it("treats invalid reviewer output as technical AnswerReviewSystemError", async () => {
    await expect(
      runAnswerReviewPipeline(
        { ...baseInput, draft: FIXTURE_DRAFT_GOOD },
        {
          enabled: true,
          reviewFn: async () => {
            throw new AnswerReviewSystemError("Reviewer returned non-JSON output.");
          },
        },
      ),
    ).rejects.toBeInstanceOf(AnswerReviewSystemError);
  });

  it("propagates abort without treating it as a failed answer", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      runAnswerReviewPipeline(
        { ...baseInput, draft: FIXTURE_DRAFT_GOOD },
        {
          enabled: true,
          signal: controller.signal,
          reviewFn: async (_input, opts) => {
            if (opts?.signal?.aborted) {
              throw new DOMException("Request aborted", "AbortError");
            }
            return reviewResult(FIXTURE_REVIEW_PASS);
          },
        },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("skips when disabled and returns the draft unchanged", async () => {
    const result = await runAnswerReviewPipeline(
      { ...baseInput, draft: FIXTURE_DRAFT_WRONG_AMOUNT },
      {
        enabled: false,
        reviewFn: async () => {
          throw new Error("must not review");
        },
      },
    );
    expect(result.meta.outcome).toBe("skipped_disabled");
    expect(result.payload).toEqual(FIXTURE_DRAFT_WRONG_AMOUNT);
  });

  it("enforces max one revision (budget)", async () => {
    let reviseCalls = 0;
    await expect(
      runAnswerReviewPipeline(
        { ...baseInput, draft: FIXTURE_DRAFT_WRONG_AMOUNT },
        {
          enabled: true,
          reviewFn: async () => reviewResult(FIXTURE_REVIEW_MATERIAL_AMOUNT),
          reviseFn: async () => {
            reviseCalls += 1;
            return {
              payload: FIXTURE_REVISED_STILL_BAD,
              rawText: "{}",
              model: "mock",
              modelRequested: "mock",
              modelReturned: "mock",
              samplingProfile: { kind: "classic_sampling", temperature: 0 },
              latencyMs: 1,
            };
          },
        },
      ),
    ).rejects.toBeInstanceOf(AnswerReviewFailedError);
    expect(reviseCalls).toBe(1);
  });
});
