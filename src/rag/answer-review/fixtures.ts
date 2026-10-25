/**
 * Deterministic fixtures for answer-review logic tests (not live model skill).
 */

import type { ContextChunk } from "../ask-types";
import type { ModelGenerationPayload } from "../ask-types";
import type { ReviewFinding, ReviewResultPayload } from "./types";

export const FIXTURE_CHUNK_A: ContextChunk = {
  chunkId: "corpus/demo:c000",
  documentId: "corpus/demo",
  relativePath: "demo.md",
  text: "השתתפות עצמית במוסך הסדר: 950 ש״ח. זכאות רק אם הרכב תוקן במוסך הסדר.",
  documentTitle: "demo",
  sectionPath: ["השתתפות"],
  pages: [1],
  warnings: [],
  origin: "retrieved",
  estimatedTokens: 40,
};

export const FIXTURE_CHUNK_B: ContextChunk = {
  chunkId: "corpus/demo:c001",
  documentId: "corpus/demo",
  relativePath: "demo.md",
  text: "במוסך שאינו בהסדר ההשתתפות היא 1,850 ש״ח.",
  documentTitle: "demo",
  sectionPath: ["השתתפות"],
  pages: [1],
  warnings: [],
  origin: "retrieved",
  estimatedTokens: 30,
};

export const FIXTURE_CONTEXTS = [FIXTURE_CHUNK_A, FIXTURE_CHUNK_B];

/** Correct complete draft — should pass review. */
export const FIXTURE_DRAFT_GOOD: ModelGenerationPayload = {
  status: "answered",
  answerParts: [
    {
      text: "במוסך הסדר ההשתתפות העצמית היא 950 ש״ח, ובתנאי שהתיקון בוצע במוסך הסדר.",
      sourceChunkIds: ["corpus/demo:c000"],
    },
  ],
};

/** Wrong amount — material unsupported_claim. */
export const FIXTURE_DRAFT_WRONG_AMOUNT: ModelGenerationPayload = {
  status: "answered",
  answerParts: [
    {
      text: "במוסך הסדר ההשתתפות היא 500 ש״ח.",
      sourceChunkIds: ["corpus/demo:c000"],
    },
  ],
};

/** Citation present but text not supported by that chunk. */
export const FIXTURE_DRAFT_BAD_CITATION: ModelGenerationPayload = {
  status: "answered",
  answerParts: [
    {
      text: "במוסך שאינו בהסדר ההשתתפות היא 500 ש״ח.",
      sourceChunkIds: ["corpus/demo:c000"],
    },
  ],
};

/** Omits material eligibility condition. */
export const FIXTURE_DRAFT_MISSING_CONDITION: ModelGenerationPayload = {
  status: "answered",
  answerParts: [
    {
      text: "ההשתתפות במוסך הסדר היא 950 ש״ח.",
      sourceChunkIds: ["corpus/demo:c000"],
    },
  ],
};

/**
 * Omits a non-material alternate garage amount when the question only asked
 * about arranged garages — should not block.
 */
export const FIXTURE_DRAFT_OMITS_IRRELEVANT: ModelGenerationPayload = {
  status: "answered",
  answerParts: [
    {
      text: "במוסך הסדר ההשתתפות היא 950 ש״ח אם התיקון במוסך הסדר.",
      sourceChunkIds: ["corpus/demo:c000"],
    },
  ],
};

/** Assumes auto product without user stating it. */
export const FIXTURE_DRAFT_UNJUSTIFIED_PRODUCT: ModelGenerationPayload = {
  status: "answered",
  answerParts: [
    {
      text: "בפוליסת רכב מקיף ההשתתפות במוסך הסדר היא 950 ש״ח.",
      sourceChunkIds: ["corpus/demo:c000"],
    },
  ],
};

/** Wrong applicability — cites update for a non-updated rule (synthetic). */
export const FIXTURE_DRAFT_WRONG_APPLICABILITY: ModelGenerationPayload = {
  status: "answered",
  answerParts: [
    {
      text: "לפי עדכון 2026 בלבד, ההשתתפות היא 950 ש״ח גם לפני מועד המעבר.",
      sourceChunkIds: ["corpus/demo:c000"],
    },
  ],
};

/** Unnecessary clarification when context already answers. */
export const FIXTURE_DRAFT_NEEDLESS_CLARIFY: ModelGenerationPayload = {
  status: "clarification_needed",
  answerParts: [
    { text: "לאיזה מוצר הכוונה?", sourceChunkIds: [] },
  ],
};

export function finding(
  partial: Partial<ReviewFinding> &
    Pick<ReviewFinding, "problemType" | "severity">,
): ReviewFinding {
  return {
    affectedPartIndex: 0,
    sourceChunkIds: ["corpus/demo:c000"],
    explanation: partial.explanation ?? "fixture",
    requiredFix: partial.requiredFix ?? "fix",
    ...partial,
  };
}

export const FIXTURE_REVIEW_PASS: ReviewResultPayload = {
  decision: "pass",
  findings: [],
};

export const FIXTURE_REVIEW_MATERIAL_AMOUNT: ReviewResultPayload = {
  decision: "revise",
  findings: [
    finding({
      problemType: "unsupported_claim",
      severity: "material",
      explanation: "Amount 500 is not in the cited source.",
      requiredFix: "Use 950 from the source or abstain.",
    }),
  ],
};

export const FIXTURE_REVIEW_SECONDARY_ONLY: ReviewResultPayload = {
  decision: "revise",
  findings: [
    finding({
      problemType: "missing_material_condition",
      severity: "secondary",
      explanation: "Could mention indexation; does not change the amount.",
      requiredFix: "Optional: note indexation.",
    }),
  ],
};

export const FIXTURE_REVISED_GOOD: ModelGenerationPayload = {
  status: "answered",
  answerParts: [
    {
      text: "במוסך הסדר ההשתתפות העצמית היא 950 ש״ח, בתנאי שהתיקון במוסך הסדר.",
      sourceChunkIds: ["corpus/demo:c000"],
    },
  ],
};

export const FIXTURE_REVISED_STILL_BAD: ModelGenerationPayload = {
  status: "answered",
  answerParts: [
    {
      text: "במוסך הסדר ההשתתפות היא 400 ש״ח.",
      sourceChunkIds: ["corpus/demo:c000"],
    },
  ],
};
