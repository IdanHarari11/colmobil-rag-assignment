import { describe, expect, it } from "vitest";
import type { Chunk } from "../chunking/types";
import { buildEmbeddingText } from "./embedding-text";

function chunk(documentId: string, text: string): Chunk {
  return {
    chunkId: `${documentId}:c000`,
    text,
    metadata: {
      documentId,
      relativePath: `${documentId}.md`,
      sourceHash: "x",
      documentTitle: "Title",
      sectionPath: ["Title"],
      sourceBlockIds: [],
      warnings: [],
      charCount: text.length,
      tokenEstimate: 10,
      tokenEstimateMethod: "heuristic_he_en_v1_max(words*1.3, chars/2.8)",
    },
  };
}

describe("buildEmbeddingText retrieval aliases", () => {
  it("appends search-only aliases for agent FAQ without replacing body", () => {
    const text = buildEmbeddingText(
      chunk(
        "corpus/30_agent_faq_en",
        "מסמך: Agent FAQ\nסעיף: Agent FAQ\n\nQ: commission clawback\nFull clawback within 120 days.",
      ),
    );
    expect(text).toMatch(/clawback/);
    expect(text).toMatch(/עמלת סוכן/);
    expect(text).toMatch(/Retrieval aliases \(search only\)/);
  });

  it("appends cash-ceiling aliases for home contents limits", () => {
    const text = buildEmbeddingText(
      chunk(
        "corpus/12_home_contents_limits",
        "מסמך: תכולה\nסעיף: תכולה\n\nפריט: מזומנים | גבול אחריות: 2,000 ₪",
      ),
    );
    expect(text).toMatch(/תקרת כיסוי למזומנים/);
    expect(text).toMatch(/מזומנים/);
  });

  it("does not add aliases for unrelated documents", () => {
    const text = buildEmbeddingText(
      chunk("corpus/28_call_center_hours", "מסמך: מוקד\n\nשישי 08:00–12:00"),
    );
    expect(text).not.toMatch(/Retrieval aliases/);
  });
});
