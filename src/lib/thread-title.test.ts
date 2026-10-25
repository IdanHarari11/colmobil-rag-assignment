import { describe, expect, it } from "vitest";
import {
  DEFAULT_THREAD_TITLE,
  fallbackTitleFromQuestion,
  firstUserTextFromMessages,
  normalizeGeneratedTitle,
  stripPiiFromTitleText,
} from "./thread-title";

describe("fallbackTitleFromQuestion", () => {
  it("returns default for empty input", () => {
    expect(fallbackTitleFromQuestion("")).toBe(DEFAULT_THREAD_TITLE);
    expect(fallbackTitleFromQuestion("   ")).toBe(DEFAULT_THREAD_TITLE);
  });

  it("strips leading question words and punctuation", () => {
    expect(fallbackTitleFromQuestion("מה שעות המוקד ביום שישי?")).toBe(
      "שעות המוקד ביום שישי",
    );
    expect(fallbackTitleFromQuestion("איזה טופס צריך לביטול פוליסה?")).toBe(
      "טופס צריך לביטול פוליסה",
    );
  });

  it("does not invent product details beyond the question", () => {
    const title = fallbackTitleFromQuestion("מה ההשתתפות העצמית?");
    expect(title).toBe("ההשתתפות העצמית");
    expect(title).not.toMatch(/רכב/);
  });

  it("limits length to about 60 characters / 7 words", () => {
    const long =
      "מה הצעדים המדויקים לטיפול בתביעת נזק לרכב פרטי עם השתתפות עצמית גבוהה מאוד בשבת בבוקר?";
    const title = fallbackTitleFromQuestion(long);
    expect(title.split(" ").length).toBeLessThanOrEqual(7);
    expect(title.length).toBeLessThanOrEqual(60);
  });

  it("strips Israeli ID-like and contact fragments", () => {
    const title = fallbackTitleFromQuestion(
      "מה הסטטוס לתעודת זהות 123456789 ולטלפון 050-1234567?",
    );
    expect(title).not.toMatch(/123456789/);
    expect(title).not.toMatch(/050/);
  });
});

describe("normalizeGeneratedTitle", () => {
  it("accepts a short Hebrew title", () => {
    expect(normalizeGeneratedTitle("שעות המוקד ביום שישי")).toBe(
      "שעות המוקד ביום שישי",
    );
  });

  it("rejects empty and English placeholders", () => {
    expect(normalizeGeneratedTitle("")).toBeNull();
    expect(normalizeGeneratedTitle("New chat")).toBeNull();
  });

  it("strips PII from model output", () => {
    const title = normalizeGeneratedTitle("בירור עבור user@example.com");
    expect(title).not.toMatch(/@/);
  });
});

describe("stripPiiFromTitleText", () => {
  it("removes emails", () => {
    expect(stripPiiFromTitleText("שלום a@b.com שלום")).toBe("שלום שלום");
  });
});

describe("firstUserTextFromMessages", () => {
  it("returns the first user text part", () => {
    expect(
      firstUserTextFromMessages([
        { role: "assistant", content: [{ type: "text", text: "hi" }] },
        { role: "user", content: [{ type: "text", text: " מה שלום? " }] },
      ]),
    ).toBe("מה שלום?");
  });
});
