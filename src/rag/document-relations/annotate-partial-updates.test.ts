import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ContextChunk } from "../ask-types";
import {
  annotateChunksForPartialUpdates,
  collectPartialUpdateBindings,
} from "./annotate-partial-updates";
import { VERIFIED_PARTIAL_UPDATE_SECTION_SPANS } from "./section-spans";
import type { ApplicabilitySummary } from "./types";

function baseChunk(text: string): ContextChunk {
  return {
    chunkId: "corpus/22_cancellation_procedure_2023:c000",
    documentId: "corpus/22_cancellation_procedure_2023",
    relativePath: "corpus/22_cancellation_procedure_2023.md",
    text,
    warnings: [],
    origin: "retrieved",
    estimatedTokens: 100,
  };
}

function updateChunk(text: string): ContextChunk {
  return {
    chunkId: "corpus/23_cancellation_procedure_update_2025:c000",
    documentId: "corpus/23_cancellation_procedure_update_2025",
    relativePath: "corpus/23_cancellation_procedure_update_2025.md",
    text,
    warnings: [],
    origin: "linked",
    estimatedTokens: 80,
  };
}

function partialApplicability(): ApplicabilitySummary {
  return {
    manifestVersion: 1,
    userTemporal: {
      hasIssueDate: false,
      hasRenewalDate: false,
      hasEventDate: true,
      dateKindsUsed: ["event"],
    },
    versionDecisions: [
      {
        documentFamily: "cancellation_procedure",
        status: "partial_update",
        selectedDocumentId: "corpus/23_cancellation_procedure_update_2025",
        alternativeDocumentIds: ["corpus/22_cancellation_procedure_2023"],
        reasonCode: "partial_update_refund_section_from_2025",
        evidenceChunkIds: [
          "corpus/22_cancellation_procedure_2023:c000",
          "corpus/23_cancellation_procedure_update_2025:c000",
        ],
      },
    ],
    activatedRelationships: [
      {
        type: "partially_updated_by",
        fromDocumentId: "corpus/22_cancellation_procedure_2023",
        toDocumentId: "corpus/23_cancellation_procedure_update_2025",
        affectedSections: ["חישוב ההחזר"],
        reasonCode: "relationship_partially_updated_by",
      },
    ],
    unresolvedNotes: [],
    promptLines: [],
  };
}

describe("annotateChunksForPartialUpdates", () => {
  it("keeps verified refund-section quotes present in the indexed chunk", async () => {
    const raw = await readFile(
      path.join(process.cwd(), "data", "chunks.json"),
      "utf8",
    );
    const chunks = JSON.parse(raw).chunks as Array<{
      id?: string;
      chunkId?: string;
      text: string;
    }>;
    const indexed = chunks.find(
      (c) =>
        (c.id ?? c.chunkId) === "corpus/22_cancellation_procedure_2023:c000",
    );
    expect(indexed).toBeTruthy();
    const span =
      VERIFIED_PARTIAL_UPDATE_SECTION_SPANS[
        "corpus/22_cancellation_procedure_2023"
      ]![0]!;
    expect(indexed!.text).toContain(span.startInclusive);
    expect(indexed!.text).toContain(span.endInclusive);
  });

  it("marks superseded refund section and keeps unreplaced principles", () => {
    const body = [
      "מסמך: נוהל ביטול פוליסה – 2023",
      "",
      "- לקוח רשאי לבטל את הפוליסה בכל עת.",
      "",
      "- ההחזר מחושב באופן יחסי לתקופה שנותרה עד תום תקופת הביטוח (pro-rata).",
      "- מסכום ההחזר מנוכים דמי טיפול בשיעור 5%.",
      "- ההחזר יועבר לאמצעי התשלום המקורי, או לחשבון בנק לפי טופס 4410, בתוך 14 ימי עסקים.",
      "",
      "- אם במהלך תקופת הביטוח שולמה תביעת אובדן גמור או גניבה.",
    ].join("\n");

    const annotated = annotateChunksForPartialUpdates(
      [baseChunk(body), updateChunk("דמי הטיפול הופחתו ל-3%")],
      partialApplicability(),
    );

    const base = annotated[0]!.text;
    expect(base).toContain("[Partial-update applicability — BASE document]");
    expect(base).toContain("<<<SUPERSEDED_SECTION name=\"חישוב ההחזר\"");
    expect(base).toContain("5%");
    expect(base).toContain("<<<END_SUPERSEDED_SECTION");
    expect(base).toContain("לקוח רשאי לבטל את הפוליסה בכל עת.");
    // Unreplaced content is outside the superseded markers.
    const superseded = base.slice(
      base.indexOf("<<<SUPERSEDED_SECTION"),
      base.indexOf("<<<END_SUPERSEDED_SECTION"),
    );
    expect(superseded).toContain("5%");
    expect(superseded).not.toContain("לקוח רשאי לבטל");

    const update = annotated[1]!.text;
    expect(update).toContain(
      "[Partial-update applicability — REPLACEMENT document]",
    );
    expect(update).toContain("3%");
  });

  it("collects section bindings from relationship affectedSections", () => {
    const bindings = collectPartialUpdateBindings(partialApplicability());
    expect(bindings).toEqual([
      expect.objectContaining({
        baseDocumentId: "corpus/22_cancellation_procedure_2023",
        updateDocumentId: "corpus/23_cancellation_procedure_update_2025",
        sectionName: "חישוב ההחזר",
        replacementFrom: "2025-01-01",
      }),
    ]);
  });

  it("does not mutate chunks when applicability has no partial update", () => {
    const chunk = baseChunk("hello");
    const out = annotateChunksForPartialUpdates([chunk], undefined);
    expect(out[0]).toEqual(chunk);
  });
});
