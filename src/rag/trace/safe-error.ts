import { HistoryValidationError } from "../history";
import { GenerationSystemError } from "../ask-types";
import {
  AnswerReviewFailedError,
  AnswerReviewSystemError,
} from "../answer-review/types";
import { RewriteSystemError } from "../rewrite-query";
import { IndexMismatchError, MissingApiKeyError } from "../types";
import type { TraceStageName } from "./types";

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/** Map thrown errors to stable codes — never raw provider/message text. */
export function safeErrorCode(error: unknown): string {
  if (isAbortError(error)) return "aborted";
  if (error instanceof HistoryValidationError) return error.code;
  if (error instanceof MissingApiKeyError) return "missing_api_key";
  if (error instanceof IndexMismatchError) return "index_mismatch";
  if (error instanceof RewriteSystemError) return "rewrite_failed";
  if (error instanceof AnswerReviewFailedError) return error.code;
  if (error instanceof AnswerReviewSystemError) return error.code;
  if (error instanceof GenerationSystemError) {
    const msg = error.message.toLowerCase();
    if (msg.includes("rewrite")) return "rewrite_failed";
    return "generation_failed";
  }
  if (error instanceof Error && error.message.includes("non-empty question")) {
    return "empty_question";
  }
  return "internal_error";
}

export function inferErrorStage(error: unknown): TraceStageName | "ask" {
  if (error instanceof RewriteSystemError) return "rewrite";
  if (error instanceof HistoryValidationError) return "ask";
  if (error instanceof AnswerReviewFailedError) return "semantic_review";
  if (error instanceof AnswerReviewSystemError) {
    const msg = error.message.toLowerCase();
    if (msg.includes("revision")) return "revision";
    return "semantic_review";
  }
  if (error instanceof GenerationSystemError) {
    const msg = error.message.toLowerCase();
    if (msg.includes("rewrite")) return "rewrite";
    if (msg.includes("citation") || msg.includes("answerparts")) {
      return "validation";
    }
    return "generation";
  }
  if (error instanceof IndexMismatchError || error instanceof MissingApiKeyError) {
    return "ask";
  }
  return "ask";
}
