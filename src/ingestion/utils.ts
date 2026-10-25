import { createHash } from "node:crypto";
import type { ContentBlock, TableData } from "./types";

export function sha256(buffer: Buffer | string): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function documentIdFromPath(relativePath: string): string {
  return relativePath.replace(/\\/g, "/").replace(/\.[^.]+$/, "");
}

export function normalizeWhitespace(text: string): string {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Strip Markdown/HTML comments; they must not enter searchable text. */
export function stripHtmlComments(markdown: string): {
  text: string;
  removedCount: number;
} {
  let removedCount = 0;
  const text = markdown.replace(/<!--[\s\S]*?-->/g, () => {
    removedCount += 1;
    return "";
  });
  return { text, removedCount };
}

export function tableTextRepresentation(
  headers: string[],
  rows: string[][],
): string {
  return rows
    .map((row) =>
      headers
        .map((header, index) => `${header}: ${row[index] ?? ""}`.trim())
        .join(" | "),
    )
    .join("\n");
}

export function buildTableData(
  headers: string[],
  rows: string[][],
  options?: {
    caption?: string;
    structureInferred?: boolean;
    extractionIncomplete?: boolean;
  },
): TableData {
  const cleanHeaders = headers.map((h) => normalizeWhitespace(h));
  const cleanRows = rows.map((row) =>
    row.map((cell) => normalizeWhitespace(cell)),
  );
  return {
    caption: options?.caption,
    headers: cleanHeaders,
    rows: cleanRows,
    textRepresentation: tableTextRepresentation(cleanHeaders, cleanRows),
    structureInferred: options?.structureInferred,
    extractionIncomplete: options?.extractionIncomplete,
  };
}

export function assignSectionPaths(blocks: ContentBlock[]): void {
  const path: string[] = [];
  for (const block of blocks) {
    if (block.type === "heading") {
      const level = block.level ?? 1;
      path.length = level - 1;
      path.push(block.text);
      block.sectionPath = [...path];
    } else if (path.length > 0) {
      block.sectionPath = [...path];
    }
  }
}

export function withBlockIds(
  documentId: string,
  blocks: Omit<ContentBlock, "id">[],
): ContentBlock[] {
  return blocks.map((block, index) => ({
    ...block,
    id: `${documentId}:b${String(index).padStart(3, "0")}`,
  }));
}
