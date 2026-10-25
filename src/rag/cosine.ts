/**
 * Cosine similarity for two equal-length vectors.
 * Returns 0 when either vector has zero magnitude.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) {
    throw new Error(
      `cosineSimilarity requires equal non-empty vectors (got ${a.length} vs ${b.length})`,
    );
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Rank items by cosine similarity to the query vector (descending). */
export function rankByCosine<T extends { embedding: number[] }>(
  query: number[],
  items: T[],
): Array<T & { score: number }> {
  return items
    .map((item) => ({
      ...item,
      score: cosineSimilarity(query, item.embedding),
    }))
    .sort((a, b) => b.score - a.score);
}
