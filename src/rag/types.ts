import type { Chunk } from "../chunking/types";

export const INDEX_FORMAT_VERSION = 1 as const;

export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
/** Default output size for text-embedding-3-small. */
export const DEFAULT_EMBEDDING_DIMENSIONS = 1536;

export interface EmbeddingConfig {
  model: string;
  dimensions: number;
}

export interface IndexManifest {
  formatVersion: typeof INDEX_FORMAT_VERSION;
  model: string;
  dimensions: number;
  /** SHA-256 of stable JSON of chunks.json input (chunkId + source content fields). */
  chunksInputHash: string;
  /** SHA-256 of embedding texts in chunkId order. */
  embeddingTextHash: string;
  createdAt: string;
  chunkCount: number;
  /** Prompt + completion style usage from the indexing API calls, when available. */
  usage?: {
    promptTokens: number;
    totalTokens: number;
  };
}

export interface IndexedChunk {
  chunkId: string;
  /** Exact string sent to the embedding API. */
  embeddingText: string;
  embedding: number[];
  chunk: Chunk;
}

export interface LocalIndex {
  manifest: IndexManifest;
  items: IndexedChunk[];
}

export type RetrieveMode = "vector" | "lexical" | "hybrid";

export interface RetrieveOptions {
  topK?: number;
  /** Retrieval strategy. Default: vector (Stage-4 baseline). */
  mode?: RetrieveMode;
  /** Override index path (tests). */
  indexPath?: string;
  /**
   * Optional precomputed question embedding (same model/dims as the index).
   * Used for fair vector/hybrid comparison so one embed serves both modes.
   */
  queryEmbedding?: number[];
}

export interface RetrievalHit {
  chunkId: string;
  documentId: string;
  relativePath: string;
  text: string;
  /** Indexed embedding text (same string BM25/vector used). */
  embeddingText?: string;
  documentTitle?: string;
  sectionPath?: string[];
  pages?: number[];
  warnings: string[];
  /**
   * Primary ranking score for the active mode:
   * vector → cosine; lexical → BM25; hybrid → RRF fusion.
   * Not a confidence probability.
   */
  score: number;
  semanticScore?: number;
  lexicalScore?: number;
  fusionScore?: number;
  /** 1-based ranks within each method when available. */
  semanticRank?: number;
  lexicalRank?: number;
}

export interface RetrieveResult {
  question: string;
  topK: number;
  mode: RetrieveMode;
  hits: RetrievalHit[];
  timingsMs: {
    questionEmbeddingMs: number;
    localSearchMs: number;
  };
  usage?: {
    promptTokens?: number;
    totalTokens?: number;
  };
  model: string;
  dimensions: number;
  /** True when hybrid fell back to pure semantic (no positive BM25 hits). */
  lexicalFallbackToSemantic?: boolean;
}

export class MissingApiKeyError extends Error {
  constructor(message = "OPENAI_API_KEY is missing. Set it in .env (see .env.example).") {
    super(message);
    this.name = "MissingApiKeyError";
  }
}

export class IndexMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IndexMismatchError";
  }
}
