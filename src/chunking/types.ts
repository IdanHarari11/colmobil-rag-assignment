export type TokenEstimateMethod =
  "heuristic_he_en_v1_max(words*1.3, chars/2.8)";

export interface TableRowRange {
  /** Inclusive 0-based index into table.rows (data rows, not header). */
  start: number;
  /** Inclusive 0-based index into table.rows. */
  end: number;
}

/**
 * Provenance and citation fields. Searchable content lives in Chunk.text only.
 */
export interface ChunkMetadata {
  documentId: string;
  relativePath: string;
  sourceHash: string;
  documentTitle?: string;
  sectionPath?: string[];
  /** Blocks whose searchable body is included in text (excluding pure context). */
  sourceBlockIds: string[];
  /**
   * Blocks that contributed only contextual prefixes (title, applicability),
   * not as if they were the primary page/section body.
   */
  contextBlockIds?: string[];
  /** Present when this chunk is a slice of a table. */
  tableRowRange?: TableRowRange;
  /** Distinct PDF pages from source blocks actually represented in the body. */
  pages?: number[];
  /** Pages that appear only via contextual prefixes, if any. */
  contextPages?: number[];
  warnings: string[];
  charCount: number;
  tokenEstimate: number;
  tokenEstimateMethod: TokenEstimateMethod;
}

export interface Chunk {
  chunkId: string;
  text: string;
  metadata: ChunkMetadata;
}

export type ChunkDocumentStatus =
  | "success"
  | "success_with_warnings"
  | "failure"
  | "skipped_empty";

export interface DocumentChunkingResult {
  documentId: string;
  relativePath: string;
  status: ChunkDocumentStatus;
  chunkCount: number;
  chunkIds: string[];
  tokenEstimates: number[];
  warnings: string[];
  intentionalOmissions: string[];
  error?: string;
}

export interface ChunkingReport {
  generatedAt: string;
  parsedDir: string;
  documentCount: number;
  chunkCount: number;
  successCount: number;
  warningCount: number;
  failureCount: number;
  skippedEmptyCount: number;
  tokenEstimateMethod: TokenEstimateMethod;
  policy: ChunkingPolicySnapshot;
  lengthSummary: {
    min: number;
    max: number;
    median: number;
    overTargetCount: number;
    targetMaxTokens: number;
  };
  documents: DocumentChunkingResult[];
}

export interface ChunkingPolicySnapshot {
  keepWholeDocumentMaxTokens: number;
  targetMaxTokens: number;
  hardMaxTokens: number;
  overlapTokens: number;
  tableSplitMinRows: number;
  tableSplitMinTokens: number;
  tableRowsPerChunk: number;
  notes: string[];
}
