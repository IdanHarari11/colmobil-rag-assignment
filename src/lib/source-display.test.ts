import { describe, expect, it } from "vitest";
import {
  formatVersionLabelHe,
  sourceDisplayHeading,
  sourcePagesLabel,
  sourceSectionLabel,
} from "./source-display";
import type { AskDisplaySource } from "./ask-display";

function src(partial: Partial<AskDisplaySource>): AskDisplaySource {
  return {
    chunkId: "c",
    documentId: "corpus/01_car_comprehensive_policy_2024",
    fileName: "01_car_comprehensive_policy_2024.pdf",
    relativePath: "corpus/01_car_comprehensive_policy_2024.pdf",
    text: "מקור",
    origin: "retrieved",
    claims: [],
    ...partial,
  };
}

describe("sourceDisplayHeading", () => {
  it("shows verified version with title", () => {
    expect(
      sourceDisplayHeading(
        src({ documentTitle: "פוליסת מקיף", versionLabel: "2024" }),
      ),
    ).toBe("פוליסת מקיף · גרסה 2024");
  });

  it("falls back to fileName when version metadata is missing", () => {
    expect(
      sourceDisplayHeading(src({ documentTitle: "פוליסת מקיף" })),
    ).toBe("01_car_comprehensive_policy_2024.pdf");
  });

  it("omits empty section/pages", () => {
    expect(sourceSectionLabel(src({ sectionPath: [] }))).toBeNull();
    expect(sourcePagesLabel(src({ pages: [] }))).toBeNull();
    expect(formatVersionLabelHe("2025_partial_update")).toBe("עדכון חלקי 2025");
  });
});
