/**
 * Explicit Chat Completions parameter profiles per model family.
 *
 * Official notes (OpenAI docs / model pages, verified 2026-10):
 * - gpt-4.1-mini: supports temperature (incl. 0) and max_tokens; no reasoning.effort.
 * - gpt-5 / gpt-5.6-* (incl. gpt-5.6-terra): Chat Completions + structured outputs supported.
 *   Many GPT-5-family models reject temperature≠1 (error: only default 1 supported).
 *   Prefer omitting temperature; use max_completion_tokens instead of max_tokens.
 *   gpt-5.6-terra documents reasoning.effort: none|low|medium(default)|high|xhigh|max.
 *
 * No silent model fallback: callers keep the requested model id.
 */

export type ReasoningEffort =
  | "none"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export type ChatCompletionSamplingProfile =
  | {
      kind: "classic_sampling";
      /** Deterministic sampling for classic chat models. */
      temperature: 0;
      /** When set, sent as max_tokens. */
      maxTokens?: number;
    }
  | {
      kind: "reasoning_family";
      /**
       * Omit temperature so the API uses its default (1).
       * Sending temperature:0 causes 400 on gpt-5.6-terra and related models.
       */
      omitTemperature: true;
      /** Prefer max_completion_tokens over max_tokens. */
      maxCompletionTokens?: number;
      /**
       * Explicit reasoning effort for GPT-5.6 Terra family.
       * Omitted when undefined (provider default — typically medium for Terra).
       */
      reasoningEffort?: ReasoningEffort;
    };

/** Models that keep classic temperature:0 behavior when selected. */
export function usesClassicSampling(model: string): boolean {
  const m = model.trim().toLowerCase();
  return (
    m.startsWith("gpt-4.1") ||
    m.startsWith("gpt-4o") ||
    m.startsWith("gpt-3.5") ||
    m === "gpt-4" ||
    m.startsWith("gpt-4-")
  );
}

/**
 * True for GPT-5 / o-series style models that reject temperature:0
 * and typically require max_completion_tokens.
 */
export function usesReasoningFamilyParams(model: string): boolean {
  const m = model.trim().toLowerCase();
  if (usesClassicSampling(m)) return false;
  return (
    m.startsWith("gpt-5") ||
    m.startsWith("o1") ||
    m.startsWith("o3") ||
    m.startsWith("o4") ||
    m.includes("terra") ||
    m.includes("luna") ||
    m.includes("sol")
  );
}

export function chatCompletionSamplingForModel(
  model: string,
  options?: {
    maxOutputTokens?: number;
    /**
     * Override reasoning effort for reasoning-family models.
     * Default: medium (OpenAI gpt-5.6-terra documented default).
     */
    reasoningEffort?: ReasoningEffort;
  },
): ChatCompletionSamplingProfile {
  if (usesReasoningFamilyParams(model)) {
    return {
      kind: "reasoning_family",
      omitTemperature: true,
      maxCompletionTokens: options?.maxOutputTokens,
      reasoningEffort: options?.reasoningEffort ?? "medium",
    };
  }
  return {
    kind: "classic_sampling",
    temperature: 0,
    maxTokens: options?.maxOutputTokens,
  };
}

/**
 * Spread into OpenAI chat.completions.create body (excluding model/messages/response_format).
 */
export function toChatCompletionRequestFields(
  profile: ChatCompletionSamplingProfile,
): Record<string, unknown> {
  if (profile.kind === "classic_sampling") {
    const fields: Record<string, unknown> = {
      temperature: profile.temperature,
    };
    if (profile.maxTokens !== undefined) {
      fields.max_tokens = profile.maxTokens;
    }
    return fields;
  }
  const fields: Record<string, unknown> = {};
  if (profile.maxCompletionTokens !== undefined) {
    fields.max_completion_tokens = profile.maxCompletionTokens;
  }
  if (profile.reasoningEffort !== undefined) {
    fields.reasoning_effort = profile.reasoningEffort;
  }
  return fields;
}

export interface ModelCallMeta {
  modelRequested: string;
  /** Provider `response.model` when present. */
  modelReturned: string;
  samplingProfile: ChatCompletionSamplingProfile;
  reasoningEffortSent?: string;
}
