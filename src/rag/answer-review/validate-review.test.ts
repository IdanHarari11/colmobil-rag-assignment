import { describe, expect, it } from "vitest";
import {
  FIXTURE_CONTEXTS,
  FIXTURE_DRAFT_GOOD,
} from "./fixtures";
import { AnswerReviewSystemError } from "./types";
import {
  parseReviewResultPayload,
  shouldAttemptRevision,
} from "./validate-review";

describe("parseReviewResultPayload", () => {
  it("accepts a valid pass payload", () => {
    const payload = parseReviewResultPayload(
      JSON.stringify({ decision: "pass", findings: [] }),
      FIXTURE_CONTEXTS,
      FIXTURE_DRAFT_GOOD.answerParts.length,
    );
    expect(payload.decision).toBe("pass");
    expect(payload.findings).toEqual([]);
  });

  it("rejects unknown sourceChunkIds from the reviewer", () => {
    expect(() =>
      parseReviewResultPayload(
        JSON.stringify({
          decision: "revise",
          findings: [
            {
              problemType: "unsupported_claim",
              affectedPartIndex: 0,
              sourceChunkIds: ["corpus/missing:c000"],
              explanation: "x",
              requiredFix: "y",
              severity: "material",
            },
          ],
        }),
        FIXTURE_CONTEXTS,
        1,
      ),
    ).toThrow(AnswerReviewSystemError);
  });

  it("rejects out-of-range affectedPartIndex", () => {
    expect(() =>
      parseReviewResultPayload(
        JSON.stringify({
          decision: "revise",
          findings: [
            {
              problemType: "unsupported_claim",
              affectedPartIndex: 9,
              sourceChunkIds: ["corpus/demo:c000"],
              explanation: "x",
              requiredFix: "y",
              severity: "material",
            },
          ],
        }),
        FIXTURE_CONTEXTS,
        1,
      ),
    ).toThrow(/affectedPartIndex/);
  });

  it("normalizes material findings with decision=pass to revise", () => {
    const payload = parseReviewResultPayload(
      JSON.stringify({
        decision: "pass",
        findings: [
          {
            problemType: "unsupported_claim",
            affectedPartIndex: 0,
            sourceChunkIds: ["corpus/demo:c000"],
            explanation: "bad amount",
            requiredFix: "fix",
            severity: "material",
          },
        ],
      }),
      FIXTURE_CONTEXTS,
      1,
    );
    expect(payload.decision).toBe("revise");
  });
});

describe("shouldAttemptRevision", () => {
  it("revises only on material findings", () => {
    expect(
      shouldAttemptRevision({
        decision: "revise",
        findings: [
          {
            problemType: "unsupported_claim",
            affectedPartIndex: 0,
            sourceChunkIds: [],
            explanation: "a",
            requiredFix: "b",
            severity: "secondary",
          },
        ],
      }),
    ).toBe(false);
    expect(
      shouldAttemptRevision({
        decision: "revise",
        findings: [
          {
            problemType: "unsupported_claim",
            affectedPartIndex: 0,
            sourceChunkIds: [],
            explanation: "a",
            requiredFix: "b",
            severity: "material",
          },
        ],
      }),
    ).toBe(true);
  });

  it("does not revise empty insufficient_evidence for unsupported_claim", () => {
    expect(
      shouldAttemptRevision(
        {
          decision: "revise",
          findings: [
            {
              problemType: "unsupported_claim",
              affectedPartIndex: null,
              sourceChunkIds: [],
              explanation: "empty",
              requiredFix: "answer",
              severity: "material",
            },
          ],
        },
        { status: "insufficient_evidence", answerParts: [] },
      ),
    ).toBe(false);
  });
});
