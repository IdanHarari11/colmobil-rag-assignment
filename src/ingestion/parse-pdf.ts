import { extractText, extractTextItems, getDocumentProxy } from "unpdf";
import type { ContentBlock, ParsedDocument, TableData } from "./types";
import {
  assignSectionPaths,
  buildTableData,
  documentIdFromPath,
  normalizeWhitespace,
  sha256,
  withBlockIds,
} from "./utils";

interface PdfTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  dir?: string;
  hasEOL?: boolean;
}

interface Line {
  y: number;
  text: string;
  fontSize: number;
  items: PdfTextItem[];
  page: number;
  minX: number;
  maxX: number;
}

/** Minimum gap (PDF units) between items that should insert a space. */
const ITEM_SPACE_GAP = 1.5;
/**
 * Max gap to merge adjacent items into one column cluster.
 * Kept below typical inter-column spacing so form IDs stay separate from names.
 */
const COLUMN_CLUSTER_GAP = 10;

/**
 * Join positioned items in RTL reading order (right → left), inserting spaces
 * from horizontal gaps. Avoids glued tokens like "לפני1.3.2026ממשיכות" without
 * regex rewrites of numbers/dates/form codes.
 */
function joinItemsRtl(items: PdfTextItem[]): string {
  if (items.length === 0) return "";
  const ordered = [...items].sort((a, b) => b.x - a.x);
  let result = ordered[0]!.str;
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1]!;
    const curr = ordered[i]!;
    const gap = prev.x - (curr.x + curr.width);
    result += (gap > ITEM_SPACE_GAP ? " " : "") + curr.str;
  }
  return normalizeWhitespace(result);
}

function clusterLines(items: PdfTextItem[], page: number): Line[] {
  const usable = items.filter((item) => item.str.trim().length > 0);
  if (usable.length === 0) return [];

  const sorted = [...usable].sort((a, b) => b.y - a.y || b.x - a.x);
  const lines: Line[] = [];
  const yTol = 3.5;

  for (const item of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - item.y) <= yTol) {
      last.items.push(item);
      last.fontSize = Math.max(last.fontSize, item.fontSize);
      last.minX = Math.min(last.minX, item.x);
      last.maxX = Math.max(last.maxX, item.x + item.width);
      continue;
    }
    lines.push({
      y: item.y,
      text: "",
      fontSize: item.fontSize,
      items: [item],
      page,
      minX: item.x,
      maxX: item.x + item.width,
    });
  }

  for (const line of lines) {
    line.text = joinItemsRtl(line.items);
  }

  return lines.filter((line) => line.text.length > 0);
}

function isBullet(text: string): boolean {
  return /^[•\-–]/.test(text);
}

function isFooter(text: string): boolean {
  return /^עמוד\s*\d+/.test(text) || /מסמך פוליסה/.test(text);
}

function isHeading(line: Line, bodyFont: number): boolean {
  if (isBullet(line.text) || isFooter(line.text)) return false;
  if (/^\d+\.\s+\S/.test(line.text)) return true;
  if (line.fontSize >= bodyFont + 2.5 && line.text.length <= 70) return true;
  return false;
}

function columnClusters(line: Line): { x: number; text: string }[] {
  const ordered = [...line.items].sort((a, b) => a.x - b.x);
  const clusters: { x: number; end: number; items: PdfTextItem[] }[] = [];

  for (const item of ordered) {
    const last = clusters[clusters.length - 1];
    if (last && item.x - last.end < COLUMN_CLUSTER_GAP) {
      last.items.push(item);
      last.end = Math.max(last.end, item.x + item.width);
    } else {
      clusters.push({
        x: item.x,
        end: item.x + item.width,
        items: [item],
      });
    }
  }

  return clusters.map((cluster) => ({
    x: cluster.x,
    text: joinItemsRtl(cluster.items),
  }));
}

function looksLikeTableHeader(line: Line): boolean {
  const clusters = columnClusters(line);
  if (clusters.length < 2) return false;
  if (isBullet(line.text)) return false;
  if (/^\d{3,5}\b/.test(line.text)) return false;
  const shortCells = clusters.filter((c) => c.text.length <= 40).length;
  return shortCells >= 2 && !/[.!?]$/.test(line.text);
}

function assignCells(
  clusters: { x: number; text: string }[],
  anchors: number[],
): string[] {
  const buckets: { x: number; text: string }[][] = anchors.map(() => []);
  for (const cluster of clusters) {
    let best = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < anchors.length; i++) {
      const dist = Math.abs(cluster.x - anchors[i]!);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    buckets[best]!.push(cluster);
  }

  return buckets.map((bucket) => {
    // RTL within a cell so fragments like תמ״א + 38 read naturally.
    const ordered = [...bucket].sort((a, b) => b.x - a.x);
    return normalizeWhitespace(ordered.map((c) => c.text).join(" "));
  });
}

function filledCellCount(cells: string[]): number {
  return cells.filter((c) => c.trim().length > 0).length;
}

/**
 * A new logical row starts when the key (leftmost) column has content that
 * opens a record — typically a form ID, or a multi-column label+value line.
 * Multi-column wraps with an empty key column are continuations.
 */
function startsNewRow(line: Line, anchors: number[]): boolean {
  const cells = assignCells(columnClusters(line), anchors);
  const key = cells[0]?.trim() ?? "";

  if (/^\d{3,5}\b/.test(key)) return true;
  if (/^\d{3,5}\b/.test(line.text.trim())) return true;
  if (!key) return false;

  // Single short fragment under the key column is a wrapped label continuation
  // (e.g. "בהסדר", "תמ״א 38"), not a new row.
  if (filledCellCount(cells) === 1 && key.length <= 40) return false;

  return filledCellCount(cells) >= 2;
}

function looksLikeSectionBreak(line: Line, bodyFont: number): boolean {
  if (isBullet(line.text) || isFooter(line.text)) return true;
  if (/^\d+\.\s+\S/.test(line.text)) return true;
  return (
    columnClusters(line).length === 1 &&
    line.text.length <= 40 &&
    !/[\d₪$%]/.test(line.text) &&
    line.fontSize >= bodyFont + 1.5
  );
}

/** Stop table region before prose that would be absorbed into the last row. */
function looksLikeProseAfterTable(line: Line, anchors: number[]): boolean {
  const cells = assignCells(columnClusters(line), anchors);
  const filled = cells.map((c) => c.trim()).filter((c) => c.length > 0);
  if (filled.length === 0) return true;
  if (filled.length === 1 && filled[0]!.length > 55) return true;
  if (line.text.length > 40 && /\.\s*$/.test(line.text)) return true;
  return false;
}

function looksLikeTableBodyLine(line: Line, anchors: number[]): boolean {
  if (looksLikeProseAfterTable(line, anchors)) return false;
  const clusters = columnClusters(line);
  if (clusters.length === 0) return false;
  if (clusters.length === 1 && line.text.length > 90) return false;
  return true;
}

function extractTableAt(
  lines: Line[],
  start: number,
  bodyFont: number,
): { end: number; table: TableData; warning: string } | null {
  const header = lines[start]!;
  if (!looksLikeTableHeader(header)) return null;

  const headerClusters = columnClusters(header);
  const anchors = headerClusters.map((c) => c.x);
  if (anchors.length < 2) return null;

  const region = [header];
  let i = start + 1;
  while (i < lines.length) {
    const line = lines[i]!;
    if (looksLikeSectionBreak(line, bodyFont)) break;
    if (isHeading(line, bodyFont) && columnClusters(line).length === 1) break;
    if (!looksLikeTableBodyLine(line, anchors)) break;
    region.push(line);
    i += 1;
    if (region.length > 40) break;
  }

  if (region.length < 2) return null;

  const rows: string[][] = [];
  for (const line of region) {
    const clusters = columnClusters(line);
    const cells = assignCells(clusters, anchors);
    if (rows.length === 0 || startsNewRow(line, anchors)) {
      rows.push(cells);
    } else {
      const prev = rows[rows.length - 1]!;
      for (let c = 0; c < anchors.length; c++) {
        if (!cells[c]) continue;
        prev[c] = normalizeWhitespace(`${prev[c]} ${cells[c]}`);
      }
      if (cells.every((c) => !c) && line.text) {
        let target = 0;
        for (let c = 0; c < prev.length; c++) {
          if ((prev[c]?.length ?? 0) >= (prev[target]?.length ?? 0)) target = c;
        }
        prev[target] = normalizeWhitespace(`${prev[target]} ${line.text}`);
      }
    }
  }

  if (rows.length < 2) return null;

  const dataRows = rows.slice(1);
  const incompleteHints = detectIncompleteTableRows(rows[0]!, dataRows);
  const table = buildTableData(rows[0]!, dataRows, {
    structureInferred: true,
    extractionIncomplete: incompleteHints.length > 0,
  });

  const warningParts = [
    `PDF table on page ${header.page} inferred from text positions.`,
  ];
  if (incompleteHints.length > 0) {
    warningParts.push(
      `Partial extraction quality: ${incompleteHints.join("; ")}.`,
    );
  }

  return {
    end: start + region.length - 1,
    table,
    warning: warningParts.join(" "),
  };
}

/**
 * Heuristic quality checks — not content hardcoding. Flags empty key cells or
 * suspiciously blank trailing columns after reconstruction.
 */
function hasUncoveredNumericToken(line: string, structuredBlob: string): boolean {
  const tokens = line.match(/\d[\d,.]*%?|\d{1,2}\.\d{1,2}\.\d{4}/g) ?? [];
  if (tokens.length === 0) {
    return /[₪$]/.test(line);
  }
  return tokens.some((token) => !structuredBlob.includes(token));
}

function detectIncompleteTableRows(
  headers: string[],
  rows: string[][],
): string[] {
  const hints: string[] = [];
  const emptyKeyRows = rows.filter((row) => !row[0]?.trim()).length;
  if (emptyKeyRows > 0) {
    hints.push(`${emptyKeyRows} row(s) with empty key column`);
  }
  if (headers.length >= 3) {
    const sparse = rows.filter((row) => filledCellCount(row) <= 1).length;
    if (sparse > 0) {
      hints.push(`${sparse} sparse row(s) with at most one filled cell`);
    }
  }
  return hints;
}

function blocksFromLines(
  lines: Line[],
  page: number,
  plainPageText: string,
): { blocks: Omit<ContentBlock, "id">[]; warnings: string[] } {
  const warnings: string[] = [];
  if (lines.length === 0) {
    const text = normalizeWhitespace(plainPageText);
    return {
      blocks: text ? [{ type: "paragraph", text, page }] : [],
      warnings: text
        ? [`Page ${page}: used plain extractText; no positioned items.`]
        : [`Page ${page}: empty.`],
    };
  }

  const bodyFont =
    lines.map((l) => l.fontSize).sort((a, b) => a - b)[
      Math.floor(lines.length / 2)
    ] ?? 12;

  const blocks: Omit<ContentBlock, "id">[] = [];
  let paragraphBuf: string[] = [];
  let listBuf: string[] = [];
  let lastHeading: string | undefined;
  const consumed = new Set<number>();

  const flushParagraph = () => {
    if (paragraphBuf.length === 0) return;
    blocks.push({
      type: "paragraph",
      text: normalizeWhitespace(paragraphBuf.join("\n")),
      page,
    });
    paragraphBuf = [];
  };
  const flushList = () => {
    if (listBuf.length === 0) return;
    blocks.push({
      type: "list",
      ordered: false,
      listItems: [...listBuf],
      text: listBuf.map((item) => `- ${item}`).join("\n"),
      page,
    });
    listBuf = [];
  };

  for (let i = 0; i < lines.length; i++) {
    if (consumed.has(i)) continue;
    const line = lines[i]!;
    if (isFooter(line.text)) continue;

    const maybeTable = extractTableAt(lines, i, bodyFont);
    if (maybeTable) {
      flushList();
      flushParagraph();
      for (let j = i; j <= maybeTable.end; j++) consumed.add(j);
      warnings.push(maybeTable.warning);
      const tableWarnings = [
        "Table structure inferred from PDF text positions; verify critical cells.",
      ];
      if (maybeTable.table.extractionIncomplete) {
        tableWarnings.push(
          "Partial extraction: some rows may be incomplete or mis-assigned after reconstruction.",
        );
      }
      blocks.push({
        type: "table",
        table: {
          ...maybeTable.table,
          caption: maybeTable.table.caption ?? lastHeading,
        },
        text: [
          maybeTable.table.caption ?? lastHeading,
          maybeTable.table.textRepresentation,
        ]
          .filter(Boolean)
          .join("\n"),
        page,
        warnings: tableWarnings,
      });
      i = maybeTable.end;
      continue;
    }

    if (isBullet(line.text)) {
      flushParagraph();
      listBuf.push(normalizeWhitespace(line.text.replace(/^[•\-–]\s*/, "")));
      continue;
    }

    if (isHeading(line, bodyFont)) {
      flushList();
      flushParagraph();
      const level = /^\d+\./.test(line.text)
        ? 2
        : line.fontSize >= bodyFont + 3
          ? 1
          : 2;
      blocks.push({ type: "heading", level, text: line.text, page });
      lastHeading = line.text;
      continue;
    }

    flushList();
    paragraphBuf.push(line.text);
  }

  flushList();
  flushParagraph();

  // Safety net: keep numeric/currency lines omitted by structure heuristics.
  // Plain extractText often glues tokens; skip lines whose numbers already exist
  // in structured (position-based) output to avoid duplicate glued fragments.
  const structuredBlob = blocks.map((b) => b.text).join("\n");
  const plain = normalizeWhitespace(plainPageText);
  const missingSnippets = plain
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(
      (s) =>
        s.length > 0 &&
        /[\d₪$%]/.test(s) &&
        !structuredBlob.includes(s) &&
        !isFooter(s) &&
        hasUncoveredNumericToken(s, structuredBlob),
    );
  if (missingSnippets.length > 0) {
    blocks.push({
      type: "paragraph",
      text: missingSnippets.join("\n"),
      page,
      warnings: [
        "Supplemental numeric plain-text lines retained because structured parse omitted them.",
      ],
    });
    warnings.push(
      `Page ${page}: retained ${missingSnippets.length} supplemental numeric line(s).`,
    );
  }

  return { blocks, warnings };
}

export async function parsePdfDocument(
  relativePath: string,
  buffer: Buffer,
): Promise<ParsedDocument> {
  const id = documentIdFromPath(relativePath);
  const warnings: string[] = [];
  const data = new Uint8Array(buffer);
  const pdf = await getDocumentProxy(data);

  const textResult = await extractText(pdf, { mergePages: false });
  const pageTexts: string[] = Array.isArray(textResult.text)
    ? textResult.text
    : [String(textResult.text)];

  const itemResult = await extractTextItems(pdf);
  const pageItems: PdfTextItem[][] = Array.isArray(itemResult.items)
    ? (itemResult.items as PdfTextItem[][])
    : [];

  const rawBlocks: Omit<ContentBlock, "id">[] = [];
  const pageCount = Math.max(pageTexts.length, pageItems.length, 1);

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
    const page = pageIndex + 1;
    const lines = clusterLines(pageItems[pageIndex] ?? [], page);
    const { blocks, warnings: pageWarnings } = blocksFromLines(
      lines,
      page,
      pageTexts[pageIndex] ?? "",
    );
    warnings.push(...pageWarnings);
    rawBlocks.push(...blocks);
  }

  if (rawBlocks.length === 0) {
    warnings.push("PDF produced no extractable text blocks.");
  }

  const title =
    rawBlocks.find((b) => b.type === "heading")?.text ||
    normalizeWhitespace(pageTexts[0]?.split("\n")[0] ?? "") ||
    relativePath.split("/").pop() ||
    relativePath;

  const blocks = withBlockIds(id, rawBlocks);
  assignSectionPaths(blocks);

  return {
    id,
    relativePath,
    format: "pdf",
    sourceHash: sha256(buffer),
    title,
    blocks,
    warnings,
    status:
      rawBlocks.length === 0
        ? "failure"
        : warnings.length > 0
          ? "success_with_warnings"
          : "success",
  };
}
