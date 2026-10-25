import { allowedChunkIds } from "../context-builder";
import type { ContextChunk, ModelGenerationPayload } from "../ask-types";
import {
  AnswerReviewSystemError,
  isReviewProblemType,
  type ReviewFinding,
  type ReviewResultPayload,
} from "./types";

function isSeverity(value: unknown): value is ReviewFinding["severity"] {
  return value === "material" || value === "secondary";
}

function isDecision(value: unknown): value is ReviewResultPayload["decision"] {
  return value === "pass" || value === "revise";
}

/**
 * Parse and validate reviewer JSON. Invalid structure → technical error
 * (not a semantic verdict that the answer is wrong).
 */
export function parseReviewResultPayload(
  raw: string,
  contextChunks: ContextChunk[],
  answerPartCount: number,
): ReviewResultPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AnswerReviewSystemError("Reviewer returned non-JSON output.");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new AnswerReviewSystemError("Reviewer JSON root must be an object.");
  }
  const obj = parsed as Record<string, unknown>;
  if (!isDecision(obj.decision)) {
    throw new AnswerReviewSystemError("Reviewer JSON missing/invalid decision.");
  }
  if (!Array.isArray(obj.findings)) {
    throw new AnswerReviewSystemError("Reviewer JSON missing findings array.");
  }

  const allowed = allowedChunkIds(contextChunks);
  const findings: ReviewFinding[] = obj.findings.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new AnswerReviewSystemError(`Invalid finding at index ${index}.`);
    }
    const f = entry as Record<string, unknown>;
    if (!isReviewProblemType(f.problemType)) {
      throw new AnswerReviewSystemError(
        `Finding ${index} has invalid problemType.`,
      );
    }
    if (!isSeverity(f.severity)) {
      throw new AnswerReviewSystemError(`Finding ${index} has invalid severity.`);
    }
    if (typeof f.explanation !== "string" || !f.explanation.trim()) {
      throw new AnswerReviewSystemError(`Finding ${index} missing explanation.`);
    }
    if (typeof f.requiredFix !== "string" || !f.requiredFix.trim()) {
      throw new AnswerReviewSystemError(`Finding ${index} missing requiredFix.`);
    }
    if (
      !Array.isArray(f.sourceChunkIds) ||
      !f.sourceChunkIds.every((x) => typeof x === "string")
    ) {
      throw new AnswerReviewSystemError(
        `Finding ${index} sourceChunkIds must be string[].`,
      );
    }

    let affectedPartIndex: number | null = null;
    if (f.affectedPartIndex === null || f.affectedPartIndex === undefined) {
      affectedPartIndex = null;
    } else if (
      typeof f.affectedPartIndex === "number" &&
      Number.isInteger(f.affectedPartIndex) &&
      f.affectedPartIndex >= 0 &&
      f.affectedPartIndex < Math.max(answerPartCount, 1)
    ) {
      affectedPartIndex = f.affectedPartIndex;
    } else if (
      typeof f.affectedPartIndex === "number" &&
      Number.isInteger(f.affectedPartIndex) &&
      answerPartCount === 0 &&
      f.affectedPartIndex === 0
    ) {
      affectedPartIndex = null;
    } else {
      throw new AnswerReviewSystemError(
        `Finding ${index} affectedPartIndex out of range.`,
      );
    }

    const sourceChunkIds = f.sourceChunkIds
      .map((id) => id.trim())
      .filter(Boolean);
    for (const id of sourceChunkIds) {
      if (!allowed.has(id)) {
        throw new AnswerReviewSystemError(
          `Finding ${index} cites unknown chunkId: ${id}`,
        );
      }
    }

    return {
      problemType: f.problemType,
      affectedPartIndex,
      sourceChunkIds,
      explanation: f.explanation.trim().slice(0, 400),
      requiredFix: f.requiredFix.trim().slice(0, 400),
      severity: f.severity,
    };
  });

  if (obj.decision === "pass" && findings.some((f) => f.severity === "material")) {
    // Soft normalize: material findings imply revise.
    return { decision: "revise", findings };
  }

  if (
    obj.decision === "revise" &&
    findings.length === 0
  ) {
    throw new AnswerReviewSystemError(
      "Reviewer decision=revise requires at least one finding.",
    );
  }

  return { decision: obj.decision, findings };
}

/**
 * True when revision should run (material issues only).
 * Neutral insufficient_evidence (empty parts) is only revised for
 * inappropriate_response_status — not for unsupported_claim on an empty draft.
 */
export function shouldAttemptRevision(
  payload: ReviewResultPayload,
  draft?: ModelGenerationPayload,
): boolean {
  if (payload.decision !== "revise") return false;
  let material = payload.findings.filter((f) => f.severity === "material");
  if (
    draft &&
    draft.status === "insufficient_evidence" &&
    draft.answerParts.length === 0
  ) {
    material = material.filter(
      (f) => f.problemType === "inappropriate_response_status",
    );
  }
  return material.length > 0;
}
