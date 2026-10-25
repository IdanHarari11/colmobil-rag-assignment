import { describe, expect, it } from "vitest";
import {
  applyHistoryWindow,
  groupHistoryTurns,
  HistoryValidationError,
  parseAndValidateHistory,
} from "./history";

describe("parseAndValidateHistory", () => {
  it("accepts empty / undefined", () => {
    expect(parseAndValidateHistory(undefined)).toEqual([]);
    expect(parseAndValidateHistory([])).toEqual([]);
  });

  it("rejects system/developer roles", () => {
    expect(() =>
      parseAndValidateHistory([{ role: "system", content: "x" }]),
    ).toThrow(HistoryValidationError);
  });

  it("normalizes user/assistant text", () => {
    expect(
      parseAndValidateHistory([
        { role: "user", content: "  שלום  " },
        { role: "assistant", content: "היי" },
      ]),
    ).toEqual([
      { role: "user", content: "שלום" },
      { role: "assistant", content: "היי" },
    ]);
  });
});

describe("applyHistoryWindow", () => {
  it("keeps newest turns within maxTurns", () => {
    const messages = [];
    for (let i = 0; i < 8; i += 1) {
      messages.push({ role: "user" as const, content: `u${i}` });
      messages.push({ role: "assistant" as const, content: `a${i}` });
    }
    const kept = applyHistoryWindow(messages, { maxTurns: 6 });
    expect(groupHistoryTurns(kept)).toHaveLength(6);
    expect(kept[0]?.content).toBe("u2");
    expect(kept.at(-1)?.content).toBe("a7");
  });

  it("drops oldest whole turns when over char budget", () => {
    const messages = [
      { role: "user" as const, content: "א".repeat(100) },
      { role: "assistant" as const, content: "ב".repeat(100) },
      { role: "user" as const, content: "ג".repeat(50) },
      { role: "assistant" as const, content: "ד".repeat(50) },
    ];
    const kept = applyHistoryWindow(messages, {
      maxTurns: 6,
      maxTotalChars: 120,
    });
    expect(kept.map((m) => m.content[0])).toEqual(["ג", "ד"]);
  });
});
