import { describe, expect, it } from "vitest";
import { loadValidatedIndex } from "../index-store";
import { defaultChunksPath } from "../paths";
import {
  ManifestValidationError,
  loadDocumentRelationsManifest,
  validateManifestAgainstIndex,
} from "./load-manifest";
import type { DocumentRelationsManifest } from "./types";

async function loadIndex() {
  return loadValidatedIndex({ chunksPath: defaultChunksPath() });
}

describe("document relations manifest validation", () => {
  it("loads and validates against the live index", async () => {
    const manifest = await loadDocumentRelationsManifest();
    const index = await loadIndex();
    expect(() => validateManifestAgainstIndex(manifest, index)).not.toThrow();
    expect(manifest.documents.length).toBeGreaterThan(0);
  });

  it("rejects stale sourceHash", async () => {
    const manifest = await loadDocumentRelationsManifest();
    const index = await loadIndex();
    const stale: DocumentRelationsManifest = {
      ...manifest,
      documents: manifest.documents.map((doc, i) =>
        i === 0
          ? {
              ...doc,
              sourceHash: "0".repeat(64),
              evidence: doc.evidence.map((e) => ({
                ...e,
                sourceHash: "0".repeat(64),
              })),
            }
          : doc,
      ),
    };
    expect(() => validateManifestAgainstIndex(stale, index)).toThrow(
      ManifestValidationError,
    );
  });

  it("rejects unknown evidence chunkIds", async () => {
    const manifest = await loadDocumentRelationsManifest();
    const index = await loadIndex();
    const broken: DocumentRelationsManifest = {
      ...manifest,
      documents: [
        {
          ...manifest.documents[0]!,
          evidence: [
            {
              chunkIds: ["corpus/does_not_exist:c000"],
              quoteSnippet: "x",
              sourceHash: manifest.documents[0]!.sourceHash,
            },
          ],
        },
      ],
    };
    expect(() => validateManifestAgainstIndex(broken, index)).toThrow(
      /unknown_chunk|Evidence chunkId/,
    );
  });
});
