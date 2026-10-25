export type SourceFormat = "md" | "pdf" | "docx";

export type BlockType = "heading" | "paragraph" | "list" | "table";

export type IngestionStatus = "success" | "success_with_warnings" | "failure";

export interface TableData {
  /** Caption or preceding heading when identifiable. */
  caption?: string;
  headers: string[];
  rows: string[][];
  /**
   * Human-readable rows binding column header to cell value.
   * Example: "פריט: מזומנים | גבול אחריות: 2,000 ₪"
   */
  textRepresentation: string;
  /** True when columns/rows were inferred heuristically (typical for PDF). */
  structureInferred?: boolean;
  /**
   * True when reconstruction heuristics flag likely incomplete or mis-assigned
   * cells. Distinct from structureInferred (layout inference ≠ information loss).
   */
  extractionIncomplete?: boolean;
}

export interface ContentBlock {
  id: string;
  type: BlockType;
  /** Plain text for search / chunking. HTML comments are never included. */
  text: string;
  level?: number;
  ordered?: boolean;
  listItems?: string[];
  table?: TableData;
  page?: number;
  sectionPath?: string[];
  warnings?: string[];
}

export interface ParsedDocument {
  id: string;
  relativePath: string;
  format: SourceFormat;
  sourceHash: string;
  title?: string;
  blocks: ContentBlock[];
  warnings: string[];
  status: IngestionStatus;
}

export interface DocumentIngestionResult {
  relativePath: string;
  id: string;
  format: SourceFormat;
  status: IngestionStatus;
  blockCount: number;
  warningCount: number;
  warnings: string[];
  error?: string;
  outputPath?: string;
}

export interface IngestionReport {
  generatedAt: string;
  corpusDir: string;
  documentCount: number;
  successCount: number;
  warningCount: number;
  failureCount: number;
  criticalFailure: boolean;
  documents: DocumentIngestionResult[];
}
