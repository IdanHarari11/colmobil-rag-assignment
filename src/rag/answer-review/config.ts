import { loadEnv } from "../env";

/**
 * Stage 5 answer review toggle.
 * Default: **off** after Stage 5 paired eval showed material false blocks
 * (e.g. valid insufficient_evidence revised then failed; travel answer blocked).
 * Enable with ANSWER_REVIEW_ENABLED=1|true|on for experiments.
 * AskOptions.answerReviewEnabled overrides the env when provided.
 */
export function isAnswerReviewEnabled(
  override?: boolean,
): boolean {
  if (override !== undefined) return override;
  loadEnv();
  const raw = process.env.ANSWER_REVIEW_ENABLED?.trim().toLowerCase();
  if (raw === undefined || raw === "") return false;
  return raw === "1" || raw === "true" || raw === "on" || raw === "yes";
}
