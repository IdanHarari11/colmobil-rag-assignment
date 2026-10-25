import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { Chunk } from "../chunking/types";
import { getEmbeddingConfig } from "./env";
import { buildExpectedFingerprint } from "./hash";
import { defaultIndexPath } from "./paths";
import {
  INDEX_FORMAT_VERSION,
  IndexMismatchError,
  type EmbeddingConfig,
  type LocalIndex,
} from "./types";

export async function loadChunksFile(chunksPath: string): Promise<Chunk[]> {
  const raw = await readFile(chunksPath, "utf8");
  const parsed = JSON.parse(raw) as { chunks?: Chunk[] };
  if (!Array.isArray(parsed.chunks)) {
    throw new Error(`Invalid chunks file (missing chunks array): ${chunksPath}`);
  }
  return parsed.chunks;
}

export async function writeLocalIndex(
  index: LocalIndex,
  indexPath: string = defaultIndexPath(),
): Promise<void> {
  await mkdir(path.dirname(indexPath), { recursive: true });
  await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
}

export async function readLocalIndex(
  indexPath: string = defaultIndexPath(),
): Promise<LocalIndex> {
  const raw = await readFile(indexPath, "utf8");
  const index = JSON.parse(raw) as LocalIndex;
  if (!index?.manifest || !Array.isArray(index.items)) {
    throw new Error(`Invalid local index file: ${indexPath}`);
  }
  return index;
}

export function assertIndexCompatible(options: {
  index: LocalIndex;
  chunks: Chunk[];
  config?: EmbeddingConfig;
}): void {
  const config = options.config ?? getEmbeddingConfig();
  const expected = buildExpectedFingerprint(options.chunks, config);
  const { manifest } = options.index;
  const problems: string[] = [];

  if (manifest.formatVersion !== INDEX_FORMAT_VERSION) {
    problems.push(
      `formatVersion ${manifest.formatVersion} != ${INDEX_FORMAT_VERSION}`,
    );
  }
  if (manifest.model !== config.model) {
    problems.push(`model "${manifest.model}" != "${config.model}"`);
  }
  if (manifest.dimensions !== config.dimensions) {
    problems.push(
      `dimensions ${manifest.dimensions} != ${config.dimensions}`,
    );
  }
  if (manifest.chunksInputHash !== expected.chunksInputHash) {
    problems.push("chunksInputHash does not match data/chunks.json");
  }
  if (manifest.embeddingTextHash !== expected.embeddingTextHash) {
    problems.push("embeddingTextHash does not match current embedding texts");
  }
  if (manifest.chunkCount !== options.chunks.length) {
    problems.push(
      `chunkCount ${manifest.chunkCount} != ${options.chunks.length}`,
    );
  }

  if (problems.length > 0) {
    throw new IndexMismatchError(
      [
        "Local embedding index is out of date or incompatible with the current chunks/embedding settings.",
        `Rebuild with: pnpm index`,
        `Details: ${problems.join("; ")}`,
      ].join(" "),
    );
  }
}

export async function loadValidatedIndex(options: {
  chunksPath: string;
  indexPath?: string;
  config?: EmbeddingConfig;
}): Promise<LocalIndex> {
  const chunks = await loadChunksFile(options.chunksPath);
  const indexPath = options.indexPath ?? defaultIndexPath();
  let index: LocalIndex;
  try {
    index = await readLocalIndex(indexPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new IndexMismatchError(
      `Local embedding index not found or unreadable at ${indexPath}. Rebuild with: pnpm index (${message})`,
    );
  }
  assertIndexCompatible({ index, chunks, config: options.config });
  return index;
}

/** True when an existing index can be reused without calling the API. */
export function canReuseIndex(
  index: LocalIndex,
  chunks: Chunk[],
  config: EmbeddingConfig,
): boolean {
  try {
    assertIndexCompatible({ index, chunks, config });
    return true;
  } catch {
    return false;
  }
}
