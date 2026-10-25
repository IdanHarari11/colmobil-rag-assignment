import { tokenizeForBm25 } from "./tokenize";

/** Okapi BM25 defaults (Robertson / standard IR). Not tuned on the 15-question set. */
export const BM25_DEFAULTS = {
  k1: 1.2,
  b: 0.75,
} as const;

export interface Bm25Document {
  id: string;
  text: string;
}

export interface Bm25Hit {
  id: string;
  /** Raw BM25 score; only positive scores are retrieval candidates. */
  score: number;
  rank: number;
}

export interface Bm25Index {
  readonly k1: number;
  readonly b: number;
  readonly documentCount: number;
  readonly avgDocLength: number;
  search(query: string): Bm25Hit[];
}

interface InternalDoc {
  id: string;
  termFreq: Map<string, number>;
  length: number;
}

/**
 * In-memory BM25 over a fixed corpus (same embeddingText strings as the vector index).
 */
export function buildBm25Index(
  documents: Bm25Document[],
  options?: { k1?: number; b?: number },
): Bm25Index {
  const k1 = options?.k1 ?? BM25_DEFAULTS.k1;
  const b = options?.b ?? BM25_DEFAULTS.b;

  const docs: InternalDoc[] = documents.map((doc) => {
    const tokens = tokenizeForBm25(doc.text);
    const termFreq = new Map<string, number>();
    for (const token of tokens) {
      termFreq.set(token, (termFreq.get(token) ?? 0) + 1);
    }
    return { id: doc.id, termFreq, length: tokens.length };
  });

  const documentCount = docs.length;
  const avgDocLength =
    documentCount === 0
      ? 0
      : docs.reduce((sum, doc) => sum + doc.length, 0) / documentCount;

  const docFreq = new Map<string, number>();
  for (const doc of docs) {
    for (const term of doc.termFreq.keys()) {
      docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
    }
  }

  function idf(term: string): number {
    const df = docFreq.get(term) ?? 0;
    // Lucene-style smoothed IDF
    return Math.log(1 + (documentCount - df + 0.5) / (df + 0.5));
  }

  return {
    k1,
    b,
    documentCount,
    avgDocLength,
    search(query: string): Bm25Hit[] {
      const queryTerms = tokenizeForBm25(query);
      if (queryTerms.length === 0 || documentCount === 0) return [];

      const uniqueQueryTerms = [...new Set(queryTerms)];
      const scored: Array<{ id: string; score: number }> = [];

      for (const doc of docs) {
        let score = 0;
        for (const term of uniqueQueryTerms) {
          const tf = doc.termFreq.get(term) ?? 0;
          if (tf === 0) continue;
          const denom =
            tf + k1 * (1 - b + b * (doc.length / (avgDocLength || 1)));
          score += idf(term) * ((tf * (k1 + 1)) / denom);
        }
        if (score > 0) {
          scored.push({ id: doc.id, score });
        }
      }

      scored.sort(
        (a, b) => b.score - a.score || a.id.localeCompare(b.id),
      );

      return scored.map((entry, index) => ({
        id: entry.id,
        score: entry.score,
        rank: index + 1,
      }));
    },
  };
}
