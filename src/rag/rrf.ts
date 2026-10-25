/** Reciprocal Rank Fusion constant (Cormack et al.). Equal weight per list. */
export const RRF_DEFAULT_C = 60;

export interface RankedCandidate {
  id: string;
  /** 1-based rank in this list. */
  rank: number;
  /** Optional raw method score for reporting (not used in RRF). */
  score?: number;
}

export interface RrfFusedHit {
  id: string;
  fusionScore: number;
  semanticRank?: number;
  lexicalRank?: number;
  semanticScore?: number;
  lexicalScore?: number;
}

/**
 * Fuse two ranked lists by chunkId with equal RRF weight:
 * score = Σ 1/(c + rank) for lists that contain the chunk.
 *
 * Tie-break (stable, documented): higher fusionScore, then better (lower)
 * semanticRank, then better lexicalRank, then chunkId ascending.
 * Missing ranks sort after present ranks.
 */
export function fuseRrf(
  semantic: RankedCandidate[],
  lexical: RankedCandidate[],
  options?: { c?: number },
): RrfFusedHit[] {
  const c = options?.c ?? RRF_DEFAULT_C;
  const byId = new Map<string, RrfFusedHit>();

  const ensure = (id: string): RrfFusedHit => {
    let entry = byId.get(id);
    if (!entry) {
      entry = { id, fusionScore: 0 };
      byId.set(id, entry);
    }
    return entry;
  };

  for (const hit of semantic) {
    const entry = ensure(hit.id);
    entry.semanticRank = hit.rank;
    entry.semanticScore = hit.score;
    entry.fusionScore += 1 / (c + hit.rank);
  }

  for (const hit of lexical) {
    const entry = ensure(hit.id);
    entry.lexicalRank = hit.rank;
    entry.lexicalScore = hit.score;
    entry.fusionScore += 1 / (c + hit.rank);
  }

  const rankOrInf = (rank: number | undefined) =>
    rank === undefined ? Number.POSITIVE_INFINITY : rank;

  return [...byId.values()].sort((a, b) => {
    if (b.fusionScore !== a.fusionScore) return b.fusionScore - a.fusionScore;
    const sem = rankOrInf(a.semanticRank) - rankOrInf(b.semanticRank);
    if (sem !== 0) return sem;
    const lex = rankOrInf(a.lexicalRank) - rankOrInf(b.lexicalRank);
    if (lex !== 0) return lex;
    return a.id.localeCompare(b.id);
  });
}
