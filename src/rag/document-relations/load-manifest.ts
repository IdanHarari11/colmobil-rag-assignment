import { readFile } from "node:fs/promises";
import path from "node:path";
import type { LocalIndex } from "../types";
import {
  DOCUMENT_RELATIONS_MANIFEST_VERSION,
  type DocumentRelationsManifest,
  type ManifestDocument,
} from "./types";

export class ManifestValidationError extends Error {
  readonly code: string;
  constructor(message: string, code = "manifest_invalid") {
    super(message);
    this.name = "ManifestValidationError";
    this.code = code;
  }
}

export function defaultManifestPath(rootDir = process.cwd()): string {
  // Static config/ segments keep Turbopack from tracing the whole repo.
  return path.join(rootDir, "config", "document-relations.manifest.json");
}

export async function loadDocumentRelationsManifest(
  manifestPath = defaultManifestPath(),
): Promise<DocumentRelationsManifest> {
  const raw = await readFile(/*turbopackIgnore: true*/ manifestPath, "utf8");
  const parsed = JSON.parse(raw) as DocumentRelationsManifest;
  if (parsed.manifestVersion !== DOCUMENT_RELATIONS_MANIFEST_VERSION) {
    throw new ManifestValidationError(
      `Unsupported manifestVersion ${String(parsed.manifestVersion)}`,
      "manifest_version_mismatch",
    );
  }
  if (!Array.isArray(parsed.documents)) {
    throw new ManifestValidationError("manifest.documents must be an array");
  }
  return parsed;
}

/**
 * Validate evidence ids and sourceHash against the loaded index.
 * Stale hashes / missing chunks fail closed (do not silently use outdated mapping).
 */
export function validateManifestAgainstIndex(
  manifest: DocumentRelationsManifest,
  index: LocalIndex,
): void {
  const byChunkId = new Map(
    index.items.map((item) => [item.chunkId, item] as const),
  );
  const documentIds = new Set(
    index.items.map((item) => item.chunk.metadata.documentId),
  );

  for (const doc of manifest.documents) {
    if (!documentIds.has(doc.documentId)) {
      throw new ManifestValidationError(
        `Unknown documentId in manifest: ${doc.documentId}`,
        "unknown_document",
      );
    }
    assertDocumentHashes(doc, byChunkId);
    for (const rel of doc.relationships) {
      if (!documentIds.has(rel.targetDocumentId)) {
        throw new ManifestValidationError(
          `Relationship target missing from index: ${rel.targetDocumentId}`,
          "unknown_relationship_target",
        );
      }
    }
  }
}

function assertDocumentHashes(
  doc: ManifestDocument,
  byChunkId: Map<string, LocalIndex["items"][number]>,
): void {
  if (doc.evidence.length === 0) {
    throw new ManifestValidationError(
      `Document ${doc.documentId} has no evidence`,
      "missing_evidence",
    );
  }
  for (const ev of doc.evidence) {
    if (!ev.chunkIds.length) {
      throw new ManifestValidationError(
        `Empty evidence.chunkIds for ${doc.documentId}`,
        "empty_evidence",
      );
    }
    for (const chunkId of ev.chunkIds) {
      const item = byChunkId.get(chunkId);
      if (!item) {
        throw new ManifestValidationError(
          `Evidence chunkId not in index: ${chunkId}`,
          "unknown_chunk",
        );
      }
      const liveHash = item.chunk.metadata.sourceHash;
      if (ev.sourceHash !== liveHash) {
        throw new ManifestValidationError(
          `Stale evidence sourceHash for ${chunkId}: manifest=${ev.sourceHash} live=${liveHash}`,
          "stale_source_hash",
        );
      }
      if (ev.sourceBlockIds?.length) {
        const liveBlocks = new Set(item.chunk.metadata.sourceBlockIds ?? []);
        for (const blockId of ev.sourceBlockIds) {
          if (!liveBlocks.has(blockId)) {
            throw new ManifestValidationError(
              `Evidence sourceBlockId not on chunk ${chunkId}: ${blockId}`,
              "unknown_source_block",
            );
          }
        }
      }
    }
  }

  const primary = byChunkId.get(`${doc.documentId}:c000`) ??
    [...byChunkId.values()].find(
      (item) => item.chunk.metadata.documentId === doc.documentId,
    );
  if (primary && doc.sourceHash !== primary.chunk.metadata.sourceHash) {
    // Document sourceHash should match a live chunk of that document.
    const anyMatch = [...byChunkId.values()].some(
      (item) =>
        item.chunk.metadata.documentId === doc.documentId &&
        item.chunk.metadata.sourceHash === doc.sourceHash,
    );
    if (!anyMatch) {
      throw new ManifestValidationError(
        `Stale document sourceHash for ${doc.documentId}`,
        "stale_document_hash",
      );
    }
  }
}

let cached:
  | { path: string; manifest: DocumentRelationsManifest }
  | undefined;

export async function getValidatedManifest(
  index: LocalIndex,
  manifestPath = defaultManifestPath(),
): Promise<DocumentRelationsManifest> {
  if (!cached || cached.path !== manifestPath) {
    cached = {
      path: manifestPath,
      manifest: await loadDocumentRelationsManifest(manifestPath),
    };
  }
  validateManifestAgainstIndex(cached.manifest, index);
  return cached.manifest;
}

/** Test helper. */
export function resetManifestCache(): void {
  cached = undefined;
}
