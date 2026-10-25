import type { TraceTokenUsage } from "./types";

type LooseUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
};

/**
 * Normalize provider usage. Null means unknown (failure/cancel), not zero.
 * cachedInputTokens is reported separately and must not be added again to totals.
 */
export function toTraceTokenUsage(
  usage: LooseUsage | null | undefined,
): TraceTokenUsage {
  if (!usage) {
    return {
      inputTokens: null,
      outputTokens: null,
      cachedInputTokens: null,
      totalTokens: null,
    };
  }
  const input =
    usage.prompt_tokens ?? usage.promptTokens ?? null;
  const output =
    usage.completion_tokens ?? usage.completionTokens ?? null;
  const cached =
    usage.prompt_tokens_details?.cached_tokens ??
    usage.cachedInputTokens ??
    null;
  const total = usage.total_tokens ?? usage.totalTokens ?? null;
  return {
    inputTokens: typeof input === "number" ? input : null,
    outputTokens: typeof output === "number" ? output : null,
    cachedInputTokens: typeof cached === "number" ? cached : null,
    totalTokens: typeof total === "number" ? total : null,
  };
}
