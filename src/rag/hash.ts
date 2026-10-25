import { createHash } from "node:crypto";
import type { Chunk } from "../chunking/types";
import { buildEmbeddingText } from "./embedding-text";
import type { EmbeddingConfig } from "./types";

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Stable fingerprint of the chunks file content that affects indexing. */
export function hashChunksInput(chunks: Chunk[]): string {
  const payload = chunks.map((chunk) => ({
    chunkId: chunk.chunkId,
    text: chunk.text,
    metadata: {
      documentId: chunk.metadata.documentId,
      relativePath: chunk.metadata.relativePath,
      sourceHash: chunk.metadata.sourceHash,
      documentTitle: chunk.metadata.documentTitle,
      sectionPath: chunk.metadata.sectionPath,
      sourceBlockIds: chunk.metadata.sourceBlockIds,
      contextBlockIds: chunk.metadata.contextBlockIds,
      tableRowRange: chunk.metadata.tableRowRange,
      pages: chunk.metadata.pages,
    },
  }));
  return sha256Hex(JSON.stringify(payload));
}

export function hashEmbeddingTexts(texts: string[]): string {
  return sha256Hex(JSON.stringify(texts));
}

export function buildExpectedFingerprint(
  chunks: Chunk[],
  config: EmbeddingConfig,
): {
  chunksInputHash: string;
  embeddingTextHash: string;
  embeddingTexts: string[];
  config: EmbeddingConfig;
} {
  const embeddingTexts = chunks.map((chunk) => buildEmbeddingText(chunk));
  return {
    chunksInputHash: hashChunksInput(chunks),
    embeddingTextHash: hashEmbeddingTexts(embeddingTexts),
    embeddingTexts,
    config,
  };
}
