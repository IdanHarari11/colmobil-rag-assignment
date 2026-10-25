import type { Chunk } from "../chunking/types";
import { createOpenAiEmbedder, type Embedder } from "./embedder";
import { getEmbeddingConfig } from "./env";
import { buildExpectedFingerprint } from "./hash";
import {
  canReuseIndex,
  loadChunksFile,
  readLocalIndex,
  writeLocalIndex,
} from "./index-store";
import { defaultChunksPath, defaultIndexPath } from "./paths";
import {
  INDEX_FORMAT_VERSION,
  type LocalIndex,
  type IndexedChunk,
} from "./types";

export interface BuildIndexOptions {
  chunksPath?: string;
  indexPath?: string;
  embedder?: Embedder;
  force?: boolean;
}

export interface BuildIndexResult {
  index: LocalIndex;
  reused: boolean;
  indexPath: string;
  embeddedCount: number;
}

export async function buildLocalIndex(
  options: BuildIndexOptions = {},
): Promise<BuildIndexResult> {
  const chunksPath = options.chunksPath ?? defaultChunksPath();
  const indexPath = options.indexPath ?? defaultIndexPath();
  const chunks = await loadChunksFile(chunksPath);
  if (chunks.length === 0) {
    throw new Error(`No chunks found in ${chunksPath}. Run pnpm chunk first.`);
  }

  const embedder = options.embedder ?? createOpenAiEmbedder();
  const config = embedder.config;
  const fingerprint = buildExpectedFingerprint(chunks, config);

  if (!options.force) {
    try {
      const existing = await readLocalIndex(indexPath);
      if (canReuseIndex(existing, chunks, config)) {
        return {
          index: existing,
          reused: true,
          indexPath,
          embeddedCount: 0,
        };
      }
    } catch {
      // Missing or invalid index → build fresh.
    }
  }

  // Reuse unchanged vectors when only a subset of texts changed.
  const previousById = new Map<string, IndexedChunk>();
  try {
    const previous = await readLocalIndex(indexPath);
    if (
      previous.manifest.model === config.model &&
      previous.manifest.dimensions === config.dimensions
    ) {
      for (const item of previous.items) {
        previousById.set(item.chunkId, item);
      }
    }
  } catch {
    // ignore
  }

  const toEmbed: { index: number; text: string }[] = [];
  const items: Array<IndexedChunk | undefined> = new Array(chunks.length);

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    const embeddingText = fingerprint.embeddingTexts[i]!;
    const prev = previousById.get(chunk.chunkId);
    if (prev && prev.embeddingText === embeddingText) {
      items[i] = {
        chunkId: chunk.chunkId,
        embeddingText,
        embedding: prev.embedding,
        chunk,
      };
    } else {
      toEmbed.push({ index: i, text: embeddingText });
    }
  }

  let promptTokens = 0;
  let totalTokens = 0;
  if (toEmbed.length > 0) {
    const batch = await embedder.embedTexts(toEmbed.map((entry) => entry.text));
    promptTokens = batch.usage.promptTokens;
    totalTokens = batch.usage.totalTokens;
    for (let j = 0; j < toEmbed.length; j++) {
      const entry = toEmbed[j]!;
      const chunk = chunks[entry.index]!;
      items[entry.index] = {
        chunkId: chunk.chunkId,
        embeddingText: entry.text,
        embedding: batch.embeddings[j]!,
        chunk,
      };
    }
  }

  const finalized = items.map((item, i) => {
    if (!item) {
      throw new Error(`Failed to embed chunk at index ${i}`);
    }
    return item;
  });

  const index: LocalIndex = {
    manifest: {
      formatVersion: INDEX_FORMAT_VERSION,
      model: config.model,
      dimensions: config.dimensions,
      chunksInputHash: fingerprint.chunksInputHash,
      embeddingTextHash: fingerprint.embeddingTextHash,
      createdAt: new Date().toISOString(),
      chunkCount: chunks.length,
      usage:
        promptTokens > 0 || totalTokens > 0
          ? { promptTokens, totalTokens }
          : undefined,
    },
    items: finalized,
  };

  await writeLocalIndex(index, indexPath);

  return {
    index,
    reused: false,
    indexPath,
    embeddedCount: toEmbed.length,
  };
}

export async function ensureIndexReady(
  options: BuildIndexOptions = {},
): Promise<LocalIndex> {
  const result = await buildLocalIndex(options);
  return result.index;
}

/** Exposed for tests that need to assemble an index without the API. */
export function buildIndexFromVectors(
  chunks: Chunk[],
  embeddings: number[][],
  config = getEmbeddingConfig(),
): LocalIndex {
  if (chunks.length !== embeddings.length) {
    throw new Error("chunks and embeddings length mismatch");
  }
  const fingerprint = buildExpectedFingerprint(chunks, config);
  return {
    manifest: {
      formatVersion: INDEX_FORMAT_VERSION,
      model: config.model,
      dimensions: config.dimensions,
      chunksInputHash: fingerprint.chunksInputHash,
      embeddingTextHash: fingerprint.embeddingTextHash,
      createdAt: new Date().toISOString(),
      chunkCount: chunks.length,
    },
    items: chunks.map((chunk, i) => ({
      chunkId: chunk.chunkId,
      embeddingText: fingerprint.embeddingTexts[i]!,
      embedding: embeddings[i]!,
      chunk,
    })),
  };
}
