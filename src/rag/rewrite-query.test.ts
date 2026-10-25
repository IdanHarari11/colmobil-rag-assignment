import { describe, expect, it } from "vitest";
import {
  buildRewriteUserPrompt,
  parseRewritePayload,
  RewriteSystemError,
} from "./rewrite-query";

describe("parseRewritePayload", () => {
  it("parses valid payload", () => {
    expect(
      parseRewritePayload(
        JSON.stringify({
          standaloneQuestion: "מה השתתפות עצמית במוסך שאינו בהסדר לרכב מקיף מ-1.3.2026?",
          unresolvedReferences: [],
        }),
      ),
    ).toMatchObject({
      standaloneQuestion: expect.stringContaining("השתתפות"),
      unresolvedReferences: [],
    });
  });

  it("rejects invalid JSON / missing fields", () => {
    expect(() => parseRewritePayload("{")).toThrow(RewriteSystemError);
    expect(() =>
      parseRewritePayload(JSON.stringify({ standaloneQuestion: "" })),
    ).toThrow(RewriteSystemError);
  });
});

describe("buildRewriteUserPrompt", () => {
  it("includes history and current question separately", () => {
    const prompt = buildRewriteUserPrompt("ומה במוסך שאינו בהסדר?", [
      { role: "user", content: "רכב מקיף מ-1.3.2026" },
      { role: "assistant", content: "מה תרצו לדעת?" },
    ]);
    expect(prompt).toContain("רכב מקיף");
    expect(prompt).toContain("ומה במוסך שאינו בהסדר?");
    expect(prompt).toContain("Current user question");
  });
});
