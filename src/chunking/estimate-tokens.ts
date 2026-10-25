import type { TokenEstimateMethod } from "./types";

export const TOKEN_ESTIMATE_METHOD: TokenEstimateMethod =
  "heuristic_he_en_v1_max(words*1.3, chars/2.8)";

/**
 * Rough token estimate for Hebrew/English mixed insurance text.
 * This is NOT a model tokenizer — use only for chunk sizing heuristics.
 */
export function estimateTokens(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  const words = trimmed.split(/\s+/).filter(Boolean).length;
  const chars = trimmed.replace(/\s+/g, "").length;
  return Math.max(1, Math.round(Math.max(words * 1.3, chars / 2.8)));
}
