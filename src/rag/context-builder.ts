import {
  estimateTokens,
  TOKEN_ESTIMATE_METHOD,
} from "../chunking/estimate-tokens";
import type { IndexedChunk, LocalIndex, RetrievalHit } from "./types";
import type { ContextBuildResult, ContextChunk } from "./ask-types";

/**
 * Soft budget for packed evidence sent to the generator.
 * Measured with the same heuristic as chunking (NOT a model tokenizer).
 */
export const DEFAULT_CONTEXT_BUDGET_TOKENS = 3500;

export const CONTEXT_BUDGET_NOTES = [
  `Budget default: ${DEFAULT_CONTEXT_BUDGET_TOKENS} estimated tokens for evidence blocks.`,
  `Measurement: ${TOKEN_ESTIMATE_METHOD} — approximate, not billing-accurate.`,
  "Whole chunks only: never truncate a chunk/table/section mid-text to fit.",
  "Retrieved top-K are packed first; same-document expansions fill remaining budget.",
  "Expansion never drops a retrieved chunk from another document to make room.",
] as const;

function packBlock(chunk: ContextChunk): string {
  const lines = [
    `[chunkId=${chunk.chunkId} | origin=${chunk.origin}]`,
    chunk.documentTitle ? `Title: ${chunk.documentTitle}` : undefined,
    chunk.relativePath ? `File: ${chunk.relativePath}` : undefined,
    chunk.sectionPath?.length
      ? `Section: ${chunk.sectionPath.join(" > ")}`
      : undefined,
    chunk.pages?.length ? `Pages: ${chunk.pages.join(", ")}` : undefined,
    "",
    chunk.text,
  ].filter((line): line is string => line !== undefined);
  return lines.join("\n");
}

function toContextChunk(
  item: IndexedChunk | RetrievalHit,
  origin: ContextChunk["origin"],
): ContextChunk {
  if ("chunk" in item) {
    const indexed = item as IndexedChunk;
    const base: ContextChunk = {
      chunkId: indexed.chunkId,
      documentId: indexed.chunk.metadata.documentId,
      relativePath: indexed.chunk.metadata.relativePath,
      text: indexed.chunk.text,
      embeddingText: indexed.embeddingText,
      documentTitle: indexed.chunk.metadata.documentTitle,
      sectionPath: indexed.chunk.metadata.sectionPath,
      pages: indexed.chunk.metadata.pages,
      warnings: indexed.chunk.metadata.warnings ?? [],
      origin,
      estimatedTokens: 0,
    };
    base.estimatedTokens = estimateTokens(packBlock(base));
    return base;
  }

  const hit = item as RetrievalHit;
  const base: ContextChunk = {
    chunkId: hit.chunkId,
    documentId: hit.documentId,
    relativePath: hit.relativePath,
    text: hit.text,
    embeddingText: hit.embeddingText,
    documentTitle: hit.documentTitle,
    sectionPath: hit.sectionPath,
    pages: hit.pages,
    warnings: hit.warnings ?? [],
    origin,
    estimatedTokens: 0,
  };
  base.estimatedTokens = estimateTokens(packBlock(base));
  return base;
}

function siblingsInCorpusOrder(
  index: LocalIndex,
  documentId: string,
  excludeIds: Set<string>,
): IndexedChunk[] {
  return index.items.filter(
    (item) =>
      item.chunk.metadata.documentId === documentId &&
      !excludeIds.has(item.chunkId),
  );
}

export interface BuildContextOptions {
  budgetTokens?: number;
}

/**
 * Build model context from Hybrid retrieval hits + same-document expansions.
 * Does not read dev_set. Does not hardcode document ids or section numbers.
 */
export function buildGenerationContext(
  retrieved: RetrievalHit[],
  index: LocalIndex,
  options: BuildContextOptions = {},
): ContextBuildResult {
  const budgetTokens = options.budgetTokens ?? DEFAULT_CONTEXT_BUDGET_TOKENS;
  const selected: ContextChunk[] = [];
  const selectedIds = new Set<string>();
  const omittedRetrieved: ContextBuildResult["omittedRetrieved"] = [];
  const omittedExpansions: ContextBuildResult["omittedExpansions"] = [];

  let used = 0;
  /** All retrieved ids — never re-add via expansion (even if omitted for budget). */
  const retrievedIds = new Set(retrieved.map((hit) => hit.chunkId));

  const tryAdd = (
    candidate: ContextChunk,
    omitList: ContextBuildResult["omittedRetrieved"],
  ): boolean => {
    if (selectedIds.has(candidate.chunkId)) return false;
    if (used + candidate.estimatedTokens > budgetTokens) {
      omitList.push({
        chunkId: candidate.chunkId,
        reason: `Would exceed context budget (${used}+${candidate.estimatedTokens} > ${budgetTokens}). Whole chunk kept out — no mid-chunk truncation.`,
      });
      return false;
    }
    selected.push(candidate);
    selectedIds.add(candidate.chunkId);
    used += candidate.estimatedTokens;
    return true;
  };

  // 1) Pack retrieved hits first (preserve retrieval order).
  for (const hit of retrieved) {
    tryAdd(toContextChunk(hit, "retrieved"), omittedRetrieved);
  }

  // 2) Expand by documentId in retrieval order; siblings in corpus/index order.
  const docOrder: string[] = [];
  for (const hit of retrieved) {
    if (!docOrder.includes(hit.documentId)) docOrder.push(hit.documentId);
  }

  const excludeFromExpansion = new Set([...selectedIds, ...retrievedIds]);
  for (const documentId of docOrder) {
    const siblings = siblingsInCorpusOrder(
      index,
      documentId,
      excludeFromExpansion,
    );
    for (const sibling of siblings) {
      if (tryAdd(toContextChunk(sibling, "expanded"), omittedExpansions)) {
        excludeFromExpansion.add(sibling.chunkId);
      }
    }
  }

  return {
    contextChunks: selected,
    omittedRetrieved,
    omittedExpansions,
    estimatedContextTokens: used,
    budgetTokens,
    tokenEstimateMethod: TOKEN_ESTIMATE_METHOD,
    contextComplete:
      omittedRetrieved.length === 0 && omittedExpansions.length === 0,
  };
}

/** Format packed evidence for the model prompt. */
export function formatContextForPrompt(chunks: ContextChunk[]): string {
  return chunks
    .map((chunk, index) => `### Source ${index + 1}\n${packBlock(chunk)}`)
    .join("\n\n");
}

export function allowedChunkIds(chunks: ContextChunk[]): Set<string> {
  return new Set(chunks.map((c) => c.chunkId));
}
