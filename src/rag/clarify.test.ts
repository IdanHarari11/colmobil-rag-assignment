import { describe, expect, it } from "vitest";
import { GenerationSystemError } from "./ask-types";
import {
  CLARIFY_SYSTEM_PROMPT,
  parseClarificationDecision,
} from "./clarify";

describe("parseClarificationDecision", () => {
  it("parses needsClarification=true with question", () => {
    const d = parseClarificationDecision(
      JSON.stringify({
        needsClarification: true,
        missingDetails: ["product"],
        clarificationQuestion: "לאיזה מוצר?",
      }),
    );
    expect(d.needsClarification).toBe(true);
    expect(d.clarificationQuestion).toBe("לאיזה מוצר?");
  });

  it("clears question when needsClarification=false", () => {
    const d = parseClarificationDecision(
      JSON.stringify({
        needsClarification: false,
        missingDetails: ["x"],
        clarificationQuestion: "should clear",
      }),
    );
    expect(d.needsClarification).toBe(false);
    expect(d.missingDetails).toEqual([]);
    expect(d.clarificationQuestion).toBe("");
  });

  it("throws GenerationSystemError on invalid JSON", () => {
    expect(() => parseClarificationDecision("nope")).toThrow(
      GenerationSystemError,
    );
  });

  it("throws when clarification required without question", () => {
    expect(() =>
      parseClarificationDecision(
        JSON.stringify({
          needsClarification: true,
          missingDetails: [],
          clarificationQuestion: "",
        }),
      ),
    ).toThrow(GenerationSystemError);
  });
});

describe("clarify prompt policy", () => {
  it("does not hardcode D05 and allows clear factual questions", () => {
    expect(CLARIFY_SYSTEM_PROMPT).not.toMatch(/D05/);
    expect(CLARIFY_SYSTEM_PROMPT).toMatch(/call-center hours|form number/i);
    expect(CLARIFY_SYSTEM_PROMPT).toMatch(/Do NOT answer the insurance question/);
  });
});
