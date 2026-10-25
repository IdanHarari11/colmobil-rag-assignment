import {
  estimateTokens,
  TOKEN_ESTIMATE_METHOD,
} from "../../chunking/estimate-tokens";
import type { ContextBuildResult, ContextChunk } from "../ask-types";
import {
  DEFAULT_CONTEXT_BUDGET_TOKENS,
} from "../context-builder";
import type { IndexedChunk, LocalIndex, RetrievalHit } from "../types";
import { extractUserTemporalFacts } from "./dates";
import type { DocumentRelationsManifest } from "./types";
import type { ApplicabilitySummary } from "./types";
import {
  buildApplicabilitySummary,
  collectActivatedRelationships,
  demotedDocumentIds,
  linkedDocumentIdsToFetch,
  resolveVersionDecisions,
} from "./resolve";

export type EnrichedContextOrigin = ContextChunk["origin"];

export interface EnrichContextOptions {
  budgetTokens?: number;
  /** Original user question + standalone rewrite (for date extraction only). */
  questionTexts: readonly string[];
  manifest: DocumentRelationsManifest;
}

export interface EnrichedContextBuildResult extends ContextBuildResult {
  applicability: ApplicabilitySummary;
  /** Chunks added via document relationships (not Hybrid top-K). */
  linkedChunkIds: string[];
  /** Why chunks were omitted during enrichment (budget / demoted version). */
  enrichmentOmissions: Array<{ chunkId: string; reasonCode: string }>;
  /** Hybrid top-K chunk ids unchanged — for metrics (Recall@5 must ignore linked). */
  hybridTopKChunkIds: string[];
}

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

/**
 * Context build with version/relationship enrichment.
 * Hybrid top-K ids are preserved for metrics; packing may omit demoted alternates.
 * Linked docs are packed separately within the same token budget (no silent overrun).
 */
export function buildEnrichedGenerationContext(
  retrieved: RetrievalHit[],
  index: LocalIndex,
  options: EnrichContextOptions,
): EnrichedContextBuildResult {
  const budgetTokens = options.budgetTokens ?? DEFAULT_CONTEXT_BUDGET_TOKENS;
  const hybridTopKChunkIds = retrieved.map((h) => h.chunkId);
  const presentDocs = new Set(retrieved.map((h) => h.documentId));

  const facts = extractUserTemporalFacts(options.questionTexts);
  const decisions = resolveVersionDecisions(
    options.manifest,
    facts,
    presentDocs,
    options.questionTexts,
  );
  const activatedRelationships = collectActivatedRelationships(
    options.manifest,
    presentDocs,
  );
  // Also activate relationships for linked targets we are about to fetch.
  const toLink = linkedDocumentIdsToFetch(activatedRelationships, presentDocs);
  for (const id of toLink) presentDocs.add(id);
  const activated = collectActivatedRelationships(options.manifest, presentDocs);

  const demoted = demotedDocumentIds(decisions);
  const applicability = buildApplicabilitySummary({
    manifest: options.manifest,
    facts,
    decisions,
    activatedRelationships: activated,
  });

  const selected: ContextChunk[] = [];
  const selectedIds = new Set<string>();
  const omittedRetrieved: ContextBuildResult["omittedRetrieved"] = [];
  const omittedExpansions: ContextBuildResult["omittedExpansions"] = [];
  const enrichmentOmissions: EnrichedContextBuildResult["enrichmentOmissions"] =
    [];
  const linkedChunkIds: string[] = [];
  let used = 0;

  const retrievedIds = new Set(retrieved.map((hit) => hit.chunkId));

  const tryAdd = (
    candidate: ContextChunk,
    omitList: ContextBuildResult["omittedRetrieved"],
    reasonCodeIfBudget: string,
  ): boolean => {
    if (selectedIds.has(candidate.chunkId)) return false;
    if (used + candidate.estimatedTokens > budgetTokens) {
      omitList.push({
        chunkId: candidate.chunkId,
        reason: `Would exceed context budget (${used}+${candidate.estimatedTokens} > ${budgetTokens}). Whole chunk kept out — no mid-chunk truncation.`,
      });
      enrichmentOmissions.push({
        chunkId: candidate.chunkId,
        reasonCode: reasonCodeIfBudget,
      });
      return false;
    }
    selected.push(candidate);
    selectedIds.add(candidate.chunkId);
    used += candidate.estimatedTokens;
    return true;
  };

  // 1) Retrieved Hybrid top-K first. hybridTopKChunkIds stay intact for Recall@5.
  // When a version is selected, demoted alternate versions are omitted from generation context.
  for (const hit of retrieved) {
    if (demoted.has(hit.documentId)) {
      enrichmentOmissions.push({
        chunkId: hit.chunkId,
        reasonCode: "demoted_version_omit_retrieved",
      });
      continue;
    }
    tryAdd(
      toContextChunk(hit, "retrieved"),
      omittedRetrieved,
      "budget_retrieved",
    );
  }

  // 2) Linked relationship documents (primary chunk + siblings later via expansion path).
  for (const documentId of toLink) {
    if (demoted.has(documentId)) {
      enrichmentOmissions.push({
        chunkId: `${documentId}:*`,
        reasonCode: "demoted_version_skip_link",
      });
      continue;
    }
    const items = index.items.filter(
      (item) => item.chunk.metadata.documentId === documentId,
    );
    // Prefer c000 / first in corpus order for link seed.
    for (const item of items) {
      if (retrievedIds.has(item.chunkId) || selectedIds.has(item.chunkId)) {
        continue;
      }
      const added = tryAdd(
        toContextChunk(item, "linked"),
        omittedExpansions,
        "budget_linked",
      );
      if (added) linkedChunkIds.push(item.chunkId);
      // Only seed one linked chunk per document here; siblings via expansion.
      if (added) break;
    }
  }

  // 3) Same-document expansions (retrieved + linked docs), skip demoted families' expansions.
  const docOrder: string[] = [];
  for (const chunk of selected) {
    if (!docOrder.includes(chunk.documentId)) docOrder.push(chunk.documentId);
  }

  const linkedDocIds = new Set(toLink);
  const excludeFromExpansion = new Set([...selectedIds, ...retrievedIds]);
  for (const documentId of docOrder) {
    if (demoted.has(documentId)) {
      enrichmentOmissions.push({
        chunkId: `${documentId}:*`,
        reasonCode: "demoted_version_skip_expansion",
      });
      continue;
    }
    const siblings = siblingsInCorpusOrder(
      index,
      documentId,
      excludeFromExpansion,
    );
    const origin: ContextChunk["origin"] = linkedDocIds.has(documentId)
      ? "linked"
      : "expanded";
    for (const sibling of siblings) {
      if (
        tryAdd(
          toContextChunk(sibling, origin),
          omittedExpansions,
          origin === "linked" ? "budget_linked_expansion" : "budget_expansion",
        )
      ) {
        excludeFromExpansion.add(sibling.chunkId);
        if (origin === "linked") linkedChunkIds.push(sibling.chunkId);
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
    applicability,
    linkedChunkIds: [...new Set(linkedChunkIds)],
    enrichmentOmissions,
    hybridTopKChunkIds,
  };
}
