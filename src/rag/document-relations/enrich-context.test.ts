import { describe, expect, it } from "vitest";
import { loadValidatedIndex } from "../index-store";
import { defaultChunksPath } from "../paths";
import { retrieve } from "../retrieve";
import { buildEnrichedGenerationContext } from "./enrich-context";
import { getValidatedManifest } from "./load-manifest";

async function loadIndex() {
  return loadValidatedIndex({ chunksPath: defaultChunksPath() });
}

describe("buildEnrichedGenerationContext", () => {
  it("links cancellation base when update is retrieved (partial update)", async () => {
    const index = await loadIndex();
    const manifest = await getValidatedManifest(index);
    const retrieval = await retrieve(
      "מה דמי הטיפול בהחזר ביטול אחרי 14 יום?",
      { mode: "hybrid", topK: 5 },
      { index },
    );
    const context = buildEnrichedGenerationContext(retrieval.hits, index, {
      questionTexts: ["מה דמי הטיפול בהחזר ביטול אחרי 14 יום?"],
      manifest,
    });
    expect(context.hybridTopKChunkIds).toEqual(
      retrieval.hits.map((h) => h.chunkId),
    );
    const docIds = new Set(context.contextChunks.map((c) => c.documentId));
    // When either cancellation doc is in play, both should appear via link or retrieve.
    const has2023 = [...docIds].some((id) => id.includes("22_cancellation"));
    const has2025 = [...docIds].some((id) => id.includes("23_cancellation"));
    expect(has2023 || has2025).toBe(true);
    if (has2025 && !retrieval.hits.some((h) => h.documentId.includes("22_"))) {
      expect(has2023).toBe(true);
      expect(context.linkedChunkIds.length).toBeGreaterThan(0);
    }
    expect(context.applicability.manifestVersion).toBe(1);
  });

  it("selects 2026 policy context for April 2026 issue wording", async () => {
    const index = await loadIndex();
    const manifest = await getValidatedManifest(index);
    const retrieval = await retrieve(
      "מה ההשתתפות במוסך הסדר בפוליסת מקיף שהונפקה באפריל 2026?",
      { mode: "hybrid", topK: 5 },
      { index },
    );
    const context = buildEnrichedGenerationContext(retrieval.hits, index, {
      questionTexts: [
        "מה ההשתתפות במוסך הסדר בפוליסת מקיף שהונפקה באפריל 2026?",
      ],
      manifest,
    });
    const decision = context.applicability.versionDecisions.find(
      (d) => d.documentFamily === "car_comprehensive_policy",
    );
    expect(decision?.selectedDocumentId).toContain("2026");
    // Demoted 2024 must not appear in generation context; hybrid top-K ids unchanged.
    expect(context.hybridTopKChunkIds.length).toBe(retrieval.hits.length);
    const contextDocs = new Set(context.contextChunks.map((c) => c.documentId));
    expect([...contextDocs].some((id) => id.includes("2024"))).toBe(false);
    expect([...contextDocs].some((id) => id.includes("2026"))).toBe(true);
    expect(
      context.enrichmentOmissions.some(
        (o) => o.reasonCode === "demoted_version_omit_retrieved",
      ),
    ).toBe(
      retrieval.hits.some((h) =>
        h.documentId.includes("01_car_comprehensive_policy_2024"),
      ),
    );
  });

  it("keeps both cancellation base and partial update in context", async () => {
    const index = await loadIndex();
    const manifest = await getValidatedManifest(index);
    const retrieval = await retrieve(
      "מה דמי הטיפול בהחזר ביטול אחרי 14 יום?",
      { mode: "hybrid", topK: 5 },
      { index },
    );
    const context = buildEnrichedGenerationContext(retrieval.hits, index, {
      questionTexts: ["מה דמי הטיפול בהחזר ביטול אחרי 14 יום?"],
      manifest,
    });
    const decision = context.applicability.versionDecisions.find(
      (d) => d.documentFamily === "cancellation_procedure",
    );
    expect(decision?.status).toBe("partial_update");
    const docs = new Set(context.contextChunks.map((c) => c.documentId));
    const hasBase = [...docs].some((id) => id.includes("22_cancellation"));
    const hasUpdate = [...docs].some((id) => id.includes("23_cancellation"));
    expect(hasBase && hasUpdate).toBe(true);
  });
});
