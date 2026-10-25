import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  chunkParsedDocuments,
  loadParsedDocuments,
  type ChunkingReport,
} from "../src/chunking";

const ROOT = process.cwd();
const PARSED_DIR = path.join(ROOT, "data", "parsed");
const CHUNKS_PATH = path.join(ROOT, "data", "chunks.json");
const REPORT_PATH = path.join(ROOT, "data", "chunking-report.json");

async function main(): Promise<void> {
  const docs = await loadParsedDocuments(PARSED_DIR);
  const { chunks, report: baseReport } = chunkParsedDocuments(docs);

  const chunkIds = new Set<string>();
  for (const chunk of chunks) {
    if (chunkIds.has(chunk.chunkId)) {
      throw new Error(`Duplicate chunkId: ${chunk.chunkId}`);
    }
    chunkIds.add(chunk.chunkId);
    if (!chunk.text.trim()) {
      throw new Error(`Empty chunk text: ${chunk.chunkId}`);
    }
  }

  const report: ChunkingReport = {
    generatedAt: new Date().toISOString(),
    parsedDir: "data/parsed",
    ...baseReport,
  };

  await mkdir(path.dirname(CHUNKS_PATH), { recursive: true });
  // Stable payload: chunks only (no generatedAt) for idempotent content hashing.
  await writeFile(CHUNKS_PATH, `${JSON.stringify({ chunks }, null, 2)}\n`, "utf8");
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(`Chunked ${report.documentCount} documents → ${chunks.length} chunks`);
  console.log(
    `success=${report.successCount} warnings=${report.warningCount} failure=${report.failureCount} empty=${report.skippedEmptyCount}`,
  );
  console.log(
    `tokenEstimate ~ min=${report.lengthSummary.min} median=${report.lengthSummary.median} max=${report.lengthSummary.max} overTarget=${report.lengthSummary.overTargetCount}`,
  );
  console.log(`Chunks: ${path.relative(ROOT, CHUNKS_PATH)}`);
  console.log(`Report: ${path.relative(ROOT, REPORT_PATH)}`);

  if (report.failureCount > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
