import { describe, expect, it } from "vitest";
import type { ThreadMessage } from "@assistant-ui/react";
import { buildAskHistoryFromThreadMessages } from "./chat-history";

function msg(
  role: "user" | "assistant",
  text: string,
  id: string,
): ThreadMessage {
  return {
    id,
    createdAt: new Date(),
    role,
    content: [{ type: "text", text }],
    attachments: [],
    metadata: { custom: {} },
  } as ThreadMessage;
}

describe("buildAskHistoryFromThreadMessages", () => {
  it("excludes the newest user question from history", () => {
    const { question, history } = buildAskHistoryFromThreadMessages([
      msg("user", "רכב מקיף מ-1.3.2026", "1"),
      msg("assistant", "מה תרצו לדעת?", "2"),
      msg("user", "ומה במוסך שאינו בהסדר?", "3"),
    ]);
    expect(question).toBe("ומה במוסך שאינו בהסדר?");
    expect(history).toEqual([
      { role: "user", content: "רכב מקיף מ-1.3.2026" },
      { role: "assistant", content: "מה תרצו לדעת?" },
    ]);
  });

  it("returns empty history for a first question", () => {
    const { question, history } = buildAskHistoryFromThreadMessages([
      msg("user", "מה שעות המוקד?", "1"),
    ]);
    expect(question).toBe("מה שעות המוקד?");
    expect(history).toEqual([]);
  });

  it("C08: uses only the active branch prior turns after edit", () => {
    // Active branch after editing the first user turn (sibling branch omitted).
    const { question, history } = buildAskHistoryFromThreadMessages([
      msg("user", "רכב מקיף מ-1.3.2026 — מוסך הסדר?", "u-edited"),
      msg("assistant", "במוסך הסדר: 1,100 ₪.", "a1"),
      msg("user", "ומה במוסך שאינו בהסדר?", "u2"),
    ]);
    expect(question).toBe("ומה במוסך שאינו בהסדר?");
    expect(history.map((m) => m.content)).toEqual([
      "רכב מקיף מ-1.3.2026 — מוסך הסדר?",
      "במוסך הסדר: 1,100 ₪.",
    ]);
    expect(history.some((m) => m.content.includes("2024"))).toBe(false);
  });
});
