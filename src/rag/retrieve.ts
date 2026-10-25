import { buildBm25Index, BM25_DEFAULTS, type Bm25Index } from "./bm25";
import { cosineSimilarity } from "./cosine";
import { createOpenAiEmbedder, type Embedder } from "./embedder";
import { loadValidatedIndex } from "./index-store";
import { defaultChunksPath, defaultIndexPath } from "./paths";
import { fuseRrf, RRF_DEFAULT_C } from "./rrf";
import type {
  IndexedChunk,
  LocalIndex,
  RetrieveMode,
  RetrieveOptions,
  RetrieveResult,
  RetrievalHit,
} from "./types";

const DEFAULT_TOP_K = 5;

export interface RetrieveDependencies {
  embedder?: Embedder;
  index?: LocalIndex;
  chunksPath?: string;
  indexPath?: string;
  /** Injected BM25 index (tests); otherwise built from index embeddingText. */
  bm25?: Bm25Index;
}

export const HYBRID_EXPERIMENT_CONFIG = {
  bm25: BM25_DEFAULTS,
  rrfC: RRF_DEFAULT_C,
  notes: [
    "Equal-weight RRF over full semantic ranking (all chunks) and positive BM25 hits.",
    "If BM25 returns no hits, hybrid equals semantic ranking.",
    "Tie-break: fusionScore desc, semanticRank asc, lexicalRank asc, chunkId asc.",
  ],
} as const;

function hitFromItem(
  item: IndexedChunk,
  fields: Partial<RetrievalHit> & { score: number },
): RetrievalHit {
  return {
    chunkId: item.chunkId,
    documentId: item.chunk.metadata.documentId,
    relativePath: item.chunk.metadata.relativePath,
    text: item.chunk.text,
    embeddingText: item.embeddingText,
    documentTitle: item.chunk.metadata.documentTitle,
    sectionPath: item.chunk.metadata.sectionPath,
    pages: item.chunk.metadata.pages,
    warnings: item.chunk.metadata.warnings ?? [],
    ...fields,
  };
}

function buildBm25FromIndex(index: LocalIndex): Bm25Index {
  return buildBm25Index(
    index.items.map((item) => ({
      id: item.chunkId,
      text: item.embeddingText,
    })),
  );
}

function rankSemantic(
  queryVector: number[],
  index: LocalIndex,
): Array<{ item: IndexedChunk; score: number; rank: number }> {
  const scored = index.items.map((item) => ({
    item,
    score: cosineSimilarity(queryVector, item.embedding),
  }));
  scored.sort(
    (a, b) =>
      b.score - a.score || a.item.chunkId.localeCompare(b.item.chunkId),
  );
  return scored.map((entry, index) => ({
    ...entry,
    rank: index + 1,
  }));
}

/**
 * Semantic / lexical / hybrid retrieval baseline.
 * No version filtering, reranking, or query expansion.
 */
export async function retrieve(
  question: string,
  options: RetrieveOptions = {},
  deps: RetrieveDependencies = {},
): Promise<RetrieveResult> {
  const trimmed = question.trim();
  if (!trimmed) {
    throw new Error("retrieve() requires a non-empty question");
  }

  const topK = options.topK ?? DEFAULT_TOP_K;
  if (!Number.isInteger(topK) || topK < 1) {
    throw new Error(`topK must be a positive integer (got ${topK})`);
  }

  const mode: RetrieveMode = options.mode ?? "vector";

  const index =
    deps.index ??
    (await loadValidatedIndex({
      chunksPath: deps.chunksPath ?? defaultChunksPath(),
      indexPath: options.indexPath ?? deps.indexPath ?? defaultIndexPath(),
      config: deps.embedder?.config,
    }));

  const byId = new Map(index.items.map((item) => [item.chunkId, item]));
  const bm25 = deps.bm25 ?? buildBm25FromIndex(index);

  let questionEmbeddingMs = 0;
  let usage: RetrieveResult["usage"];
  let queryVector = options.queryEmbedding;

  const needsEmbedding = mode === "vector" || mode === "hybrid";
  if (needsEmbedding && !queryVector) {
    const embedder =
      deps.embedder ??
      createOpenAiEmbedder({
        config: {
          model: index.manifest.model,
          dimensions: index.manifest.dimensions,
        },
      });

    if (
      embedder.config.model !== index.manifest.model ||
      embedder.config.dimensions !== index.manifest.dimensions
    ) {
      throw new Error(
        `Question embedder (${embedder.config.model}/${embedder.config.dimensions}) ` +
          `must match index (${index.manifest.model}/${index.manifest.dimensions})`,
      );
    }

    const embedStarted = performance.now();
    const embedded = await embedder.embedTexts([trimmed]);
    questionEmbeddingMs = performance.now() - embedStarted;
    queryVector = embedded.embeddings[0]!;
    usage = {
      promptTokens: embedded.usage.promptTokens,
      totalTokens: embedded.usage.totalTokens,
    };
  }

  if (needsEmbedding && queryVector?.length !== index.manifest.dimensions) {
    throw new Error(
      `queryEmbedding length ${queryVector?.length ?? 0} != index dims ${index.manifest.dimensions}`,
    );
  }

  const searchStarted = performance.now();
  let hits: RetrievalHit[] = [];
  let lexicalFallbackToSemantic = false;

  if (mode === "lexical") {
    const lexicalHits = bm25.search(trimmed);
    hits = lexicalHits.slice(0, topK).map((hit) => {
      const item = byId.get(hit.id);
      if (!item) {
        throw new Error(`BM25 returned unknown chunkId: ${hit.id}`);
      }
      return hitFromItem(item, {
        score: hit.score,
        lexicalScore: hit.score,
        lexicalRank: hit.rank,
      });
    });
  } else if (mode === "vector") {
    const semantic = rankSemantic(queryVector!, index);
    hits = semantic.slice(0, topK).map((entry) =>
      hitFromItem(entry.item, {
        score: entry.score,
        semanticScore: entry.score,
        semanticRank: entry.rank,
      }),
    );
  } else {
    // hybrid
    const semantic = rankSemantic(queryVector!, index);
    const lexicalHits = bm25.search(trimmed);

    if (lexicalHits.length === 0) {
      lexicalFallbackToSemantic = true;
      hits = semantic.slice(0, topK).map((entry) =>
        hitFromItem(entry.item, {
          score: entry.score,
          semanticScore: entry.score,
          semanticRank: entry.rank,
          fusionScore: undefined,
        }),
      );
    } else {
      const fused = fuseRrf(
        semantic.map((entry) => ({
          id: entry.item.chunkId,
          rank: entry.rank,
          score: entry.score,
        })),
        lexicalHits.map((hit) => ({
          id: hit.id,
          rank: hit.rank,
          score: hit.score,
        })),
        { c: HYBRID_EXPERIMENT_CONFIG.rrfC },
      );

      hits = fused.slice(0, topK).map((entry) => {
        const item = byId.get(entry.id);
        if (!item) {
          throw new Error(`RRF returned unknown chunkId: ${entry.id}`);
        }
        return hitFromItem(item, {
          score: entry.fusionScore,
          fusionScore: entry.fusionScore,
          semanticScore: entry.semanticScore,
          lexicalScore: entry.lexicalScore,
          semanticRank: entry.semanticRank,
          lexicalRank: entry.lexicalRank,
        });
      });
    }
  }

  const localSearchMs = performance.now() - searchStarted;

  return {
    question: trimmed,
    topK,
    mode,
    hits,
    timingsMs: {
      questionEmbeddingMs,
      localSearchMs,
    },
    usage,
    model: index.manifest.model,
    dimensions: index.manifest.dimensions,
    lexicalFallbackToSemantic:
      mode === "hybrid" ? lexicalFallbackToSemantic : undefined,
  };
}
