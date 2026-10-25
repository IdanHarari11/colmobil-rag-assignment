import { describe, expect, it } from "vitest";
import {
  chatCompletionSamplingForModel,
  toChatCompletionRequestFields,
  usesClassicSampling,
  usesReasoningFamilyParams,
} from "./model-request-params";

describe("model-request-params", () => {
  it("keeps temperature:0 for gpt-4.1-mini", () => {
    expect(usesClassicSampling("gpt-4.1-mini")).toBe(true);
    const profile = chatCompletionSamplingForModel("gpt-4.1-mini");
    expect(profile).toEqual({ kind: "classic_sampling", temperature: 0 });
    expect(toChatCompletionRequestFields(profile)).toEqual({ temperature: 0 });
  });

  it("omits temperature for gpt-5.6-terra and sends reasoning_effort", () => {
    expect(usesReasoningFamilyParams("gpt-5.6-terra")).toBe(true);
    const profile = chatCompletionSamplingForModel("gpt-5.6-terra", {
      maxOutputTokens: 400,
    });
    expect(profile.kind).toBe("reasoning_family");
    const fields = toChatCompletionRequestFields(profile);
    expect(fields.temperature).toBeUndefined();
    expect(fields.max_tokens).toBeUndefined();
    expect(fields.max_completion_tokens).toBe(400);
    expect(fields.reasoning_effort).toBe("medium");
  });

  it("does not silently map terra to another model id", () => {
    const profile = chatCompletionSamplingForModel("gpt-5.6-terra");
    expect(profile.kind).toBe("reasoning_family");
    // Caller must still pass model: "gpt-5.6-terra" — this helper never renames.
  });
});
