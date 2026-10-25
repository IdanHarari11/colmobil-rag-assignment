import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  detectFormat,
  parseCorpusFile,
  type DocumentIngestionResult,
  type IngestionReport,
  type ParsedDocument,
} from "../src/ingestion";

const ROOT = process.cwd();
const CORPUS_DIR = path.join(ROOT, "corpus");
const OUT_DIR = path.join(ROOT, "data", "parsed");
const REPORT_PATH = path.join(ROOT, "data", "ingestion-report.json");

async function listCorpusFiles(): Promise<string[]> {
  const entries = await readdir(CORPUS_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && detectFormat(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

function outputFileName(relativePath: string): string {
  return `${relativePath.replace(/\.[^.]+$/, "")}.json`;
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const files = await listCorpusFiles();
  const results: DocumentIngestionResult[] = [];
  let criticalFailure = false;

  for (const fileName of files) {
    const absolutePath = path.join(CORPUS_DIR, fileName);
    const relativePath = path.posix.join("corpus", fileName);

    let parsed: ParsedDocument;
    try {
      parsed = await parseCorpusFile(absolutePath, relativePath);
    } catch (error) {
      criticalFailure = true;
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        relativePath,
        id: fileName,
        format: detectFormat(fileName) ?? "md",
        status: "failure",
        blockCount: 0,
        warningCount: 0,
        warnings: [],
        error: message,
      });
      continue;
    }

    if (parsed.status === "failure") {
      criticalFailure = true;
      results.push({
        relativePath,
        id: parsed.id,
        format: parsed.format,
        status: "failure",
        blockCount: parsed.blocks.length,
        warningCount: parsed.warnings.length,
        warnings: parsed.warnings,
        error: "Parser returned failure status with no usable blocks.",
      });
      continue;
    }

    const outName = outputFileName(fileName);
    const outputPath = path.join(OUT_DIR, outName);
    // Stable JSON: no generatedAt inside per-document payload.
    const payload = {
      id: parsed.id,
      relativePath: parsed.relativePath,
      format: parsed.format,
      sourceHash: parsed.sourceHash,
      title: parsed.title,
      status: parsed.status,
      warnings: parsed.warnings,
      blocks: parsed.blocks,
    };
    await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

    results.push({
      relativePath,
      id: parsed.id,
      format: parsed.format,
      status: parsed.status,
      blockCount: parsed.blocks.length,
      warningCount: parsed.warnings.length,
      warnings: parsed.warnings,
      outputPath: path.relative(ROOT, outputPath),
    });
  }

  const report: IngestionReport = {
    generatedAt: new Date().toISOString(),
    corpusDir: "corpus",
    documentCount: results.length,
    successCount: results.filter((r) => r.status === "success").length,
    warningCount: results.filter((r) => r.status === "success_with_warnings")
      .length,
    failureCount: results.filter((r) => r.status === "failure").length,
    criticalFailure,
    documents: results,
  };

  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(
    `Ingested ${report.documentCount} documents → ${path.relative(ROOT, OUT_DIR)}`,
  );
  console.log(
    `success=${report.successCount} warnings=${report.warningCount} failure=${report.failureCount}`,
  );
  console.log(`Report: ${path.relative(ROOT, REPORT_PATH)}`);

  if (criticalFailure) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
