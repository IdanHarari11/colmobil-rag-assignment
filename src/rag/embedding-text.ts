import type { Chunk } from "../chunking/types";
import { normalizeWhitespace } from "../ingestion/utils";
import { retrievalAliasesForDocument } from "./retrieval-aliases";

/**
 * Build the exact string sent to the embedding model / BM25 corpus.
 *
 * Included: document title, section path, chunk body content, and optional
 * corpus-grounded retrieval aliases (search only — not citation text).
 * Excluded: chunkId, documentId, hashes, block ids, pages, warnings,
 * token estimates, and other technical metadata.
 */
export function buildEmbeddingText(chunk: Chunk): string {
  const lines: string[] = [];
  const title = chunk.metadata.documentTitle?.trim();
  if (title) lines.push(title);

  const section = chunk.metadata.sectionPath?.filter(Boolean).join(" > ").trim();
  if (section && section !== title) lines.push(section);

  const body = extractSearchableBody(chunk.text, title, section);
  if (body) lines.push(body);

  const aliases = retrievalAliasesForDocument(chunk.metadata.documentId);
  if (aliases.length > 0) {
    lines.push("Retrieval aliases (search only):");
    for (const alias of aliases) {
      lines.push(alias);
    }
  }

  return normalizeWhitespace(lines.join("\n"));
}

/**
 * Prefer the body after the structured prefixes written at chunk time.
 * Falls back to full text if prefixes are absent.
 */
function extractSearchableBody(
  text: string,
  title?: string,
  section?: string,
): string {
  const lines = text.split("\n");
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!.trim();
    if (!line) {
      index += 1;
      continue;
    }
    if (line.startsWith("מסמך:")) {
      index += 1;
      continue;
    }
    if (line.startsWith("סעיף:")) {
      index += 1;
      continue;
    }
    if (line.startsWith("תחולת מקור:")) {
      // Applicability is content, not a technical id — keep it in the body.
      break;
    }
    break;
  }

  let body = lines.slice(index).join("\n").trim();
  if (!body) {
    body = text.trim();
  }

  // Drop accidental duplication of title/section as the sole body.
  if (body === title || body === section) return "";
  return body;
}
