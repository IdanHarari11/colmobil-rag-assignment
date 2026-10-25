import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseDocxDocument } from "./parse-docx";
import { parseMarkdownDocument } from "./parse-markdown";
import { parsePdfDocument } from "./parse-pdf";
import type { ParsedDocument, SourceFormat } from "./types";

export type {
  BlockType,
  ContentBlock,
  DocumentIngestionResult,
  IngestionReport,
  IngestionStatus,
  ParsedDocument,
  SourceFormat,
  TableData,
} from "./types";

export function detectFormat(filePath: string): SourceFormat | null {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".md" || ext === ".markdown") return "md";
  if (ext === ".pdf") return "pdf";
  if (ext === ".docx") return "docx";
  return null;
}

export async function parseCorpusFile(
  absolutePath: string,
  relativePath: string,
): Promise<ParsedDocument> {
  const format = detectFormat(absolutePath);
  if (!format) {
    return {
      id: relativePath,
      relativePath,
      format: "md",
      sourceHash: "",
      blocks: [],
      warnings: [`Unsupported file extension: ${path.extname(absolutePath)}`],
      status: "failure",
    };
  }

  if (format === "md") {
    const source = await readFile(absolutePath, "utf8");
    return parseMarkdownDocument(relativePath, source);
  }

  const buffer = await readFile(absolutePath);
  if (format === "pdf") return parsePdfDocument(relativePath, buffer);
  return parseDocxDocument(relativePath, buffer);
}
