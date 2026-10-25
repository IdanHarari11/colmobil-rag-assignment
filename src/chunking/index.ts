import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { ParsedDocument } from "../ingestion/types";
import { chunkDocument } from "./chunk-document";
import { TOKEN_ESTIMATE_METHOD } from "./estimate-tokens";
import { CHUNKING_POLICY } from "./policy";
import type {
  Chunk,
  ChunkingReport,
  DocumentChunkingResult,
} from "./types";

export type {
  Chunk,
  ChunkMetadata,
  ChunkingReport,
  DocumentChunkingResult,
  TableRowRange,
} from "./types";
export { chunkDocument, splitNumberedClauses } from "./chunk-document";
export { estimateTokens, TOKEN_ESTIMATE_METHOD } from "./estimate-tokens";
export { CHUNKING_POLICY } from "./policy";

export async function loadParsedDocuments(
  parsedDir: string,
): Promise<ParsedDocument[]> {
  const names = (await readdir(parsedDir))
    .filter((name) => name.endsWith(".json"))
    .sort((a, b) => a.localeCompare(b));

  const docs: ParsedDocument[] = [];
  for (const name of names) {
    const raw = await readFile(path.join(parsedDir, name), "utf8");
    docs.push(JSON.parse(raw) as ParsedDocument);
  }
  return docs;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
  }
  return sorted[mid]!;
}

export function chunkParsedDocuments(docs: ParsedDocument[]): {
  chunks: Chunk[];
  report: Omit<ChunkingReport, "generatedAt" | "parsedDir">;
  results: DocumentChunkingResult[];
} {
  const chunks: Chunk[] = [];
  const results: DocumentChunkingResult[] = [];

  for (const doc of docs) {
    const { chunks: docChunks, result } = chunkDocument(doc);
    chunks.push(...docChunks);
    results.push(result);
  }

  const tokenEstimates = chunks.map((c) => c.metadata.tokenEstimate);
  const overTargetCount = tokenEstimates.filter(
    (t) => t > CHUNKING_POLICY.targetMaxTokens,
  ).length;

  return {
    chunks,
    results,
    report: {
      documentCount: docs.length,
      chunkCount: chunks.length,
      successCount: results.filter((r) => r.status === "success").length,
      warningCount: results.filter((r) => r.status === "success_with_warnings")
        .length,
      failureCount: results.filter((r) => r.status === "failure").length,
      skippedEmptyCount: results.filter((r) => r.status === "skipped_empty")
        .length,
      tokenEstimateMethod: TOKEN_ESTIMATE_METHOD,
      policy: CHUNKING_POLICY,
      lengthSummary: {
        min: tokenEstimates.length ? Math.min(...tokenEstimates) : 0,
        max: tokenEstimates.length ? Math.max(...tokenEstimates) : 0,
        median: median(tokenEstimates),
        overTargetCount,
        targetMaxTokens: CHUNKING_POLICY.targetMaxTokens,
      },
      documents: results,
    },
  };
}
