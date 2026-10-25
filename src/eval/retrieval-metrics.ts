import type { RetrievalHit } from "../rag/types";

/** Normalize reference source filenames and indexed paths for comparison. */
export function normalizeSourceKey(value: string): string {
  const base = value.replace(/\\/g, "/").split("/").pop() ?? value;
  return base.trim().toLowerCase();
}

export function documentKeyFromHit(hit: RetrievalHit): string {
  return normalizeSourceKey(hit.relativePath || hit.documentId);
}

/**
 * Document Recall@K: fraction of unique reference documents that appear
 * among the first K retrieved chunks. Duplicate hits of the same document
 * do not increase the score.
 */
export function documentRecallAtK(
  hits: RetrievalHit[],
  referenceSources: string[],
  k: number,
): number | null {
  const refs = [...new Set(referenceSources.map(normalizeSourceKey).filter(Boolean))];
  if (refs.length === 0) return null;

  const top = hits.slice(0, k);
  const found = new Set<string>();
  for (const hit of top) {
    const key = documentKeyFromHit(hit);
    if (refs.includes(key)) found.add(key);
  }
  return found.size / refs.length;
}

/** Reciprocal rank of the first hit whose document is in the reference set. */
export function reciprocalRank(
  hits: RetrievalHit[],
  referenceSources: string[],
): number | null {
  const refs = new Set(referenceSources.map(normalizeSourceKey).filter(Boolean));
  if (refs.size === 0) return null;

  for (let i = 0; i < hits.length; i++) {
    const key = documentKeyFromHit(hits[i]!);
    if (refs.has(key)) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
