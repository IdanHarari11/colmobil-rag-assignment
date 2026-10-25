import type { ContentBlock, ParsedDocument, TableData } from "../ingestion/types";
import { normalizeWhitespace } from "../ingestion/utils";
import { estimateTokens, TOKEN_ESTIMATE_METHOD } from "./estimate-tokens";
import { CHUNKING_POLICY } from "./policy";
import type {
  Chunk,
  ChunkMetadata,
  DocumentChunkingResult,
  TableRowRange,
} from "./types";

const APPLICABILITY_RE =
  /(בתוקף|גרסה\s*\d{4}|מהדורה|חלים על|מעודכן ל|אלא אם נקבע אחרת)/;

interface BuildState {
  chunks: Chunk[];
  omissions: string[];
  warnings: string[];
}

function uniqueSortedPages(pages: Array<number | undefined>): number[] | undefined {
  const values = [
    ...new Set(pages.filter((p): p is number => typeof p === "number")),
  ].sort((a, b) => a - b);
  return values.length > 0 ? values : undefined;
}

function collectWarnings(blocks: ContentBlock[]): string[] {
  const out: string[] = [];
  for (const block of blocks) {
    for (const warning of block.warnings ?? []) {
      if (!out.includes(warning)) out.push(warning);
    }
  }
  return out;
}

function isHeadingOnly(block: ContentBlock): boolean {
  return block.type === "heading";
}

function isSearchableBody(block: ContentBlock): boolean {
  if (isHeadingOnly(block)) return false;
  return normalizeWhitespace(block.text ?? "").length > 0;
}

function tableBodyText(table: TableData, rowStart: number, rowEnd: number): string {
  const slice = table.rows.slice(rowStart, rowEnd + 1);
  const lines = slice.map((row) =>
    table.headers
      .map((header, index) => `${header}: ${row[index] ?? ""}`.trim())
      .join(" | "),
  );
  const caption = table.caption ? `טבלה: ${table.caption}` : undefined;
  return normalizeWhitespace([caption, ...lines].filter(Boolean).join("\n"));
}

function shouldSplitTable(table: TableData): boolean {
  const tokens = estimateTokens(table.textRepresentation);
  // Require both size signals so compact short-doc tables (e.g. glossary)
  // stay whole, while large catalogs still split for retrieval.
  return (
    table.rows.length >= CHUNKING_POLICY.tableSplitMinRows &&
    tokens >= CHUNKING_POLICY.tableSplitMinTokens
  );
}

function findApplicabilityBlocks(doc: ParsedDocument): ContentBlock[] {
  return doc.blocks.filter(
    (block) =>
      block.type === "paragraph" &&
      APPLICABILITY_RE.test(block.text) &&
      estimateTokens(block.text) <= 180,
  );
}

function buildPrefix(options: {
  documentTitle?: string;
  sectionPath?: string[];
  applicabilityTexts: string[];
}): string {
  const lines: string[] = [];
  if (options.documentTitle) {
    lines.push(`מסמך: ${options.documentTitle}`);
  }
  if (options.sectionPath && options.sectionPath.length > 0) {
    lines.push(`סעיף: ${options.sectionPath.join(" > ")}`);
  }
  for (const text of options.applicabilityTexts) {
    lines.push(`תחולת מקור: ${text}`);
  }
  return lines.join("\n");
}

function finalizeChunk(options: {
  document: ParsedDocument;
  index: number;
  bodyText: string;
  sourceBlocks: ContentBlock[];
  contextBlocks: ContentBlock[];
  sectionPath?: string[];
  tableRowRange?: TableRowRange;
  extraWarnings?: string[];
}): Chunk {
  const prefix = buildPrefix({
    documentTitle: options.document.title,
    sectionPath: options.sectionPath,
    applicabilityTexts: options.contextBlocks
      .filter((b) => APPLICABILITY_RE.test(b.text))
      .map((b) => normalizeWhitespace(b.text)),
  });

  // Avoid duplicating title/applicability when they are already the body.
  const contextIds = new Set(options.contextBlocks.map((b) => b.id));
  const bodyAlreadyHasContext = options.sourceBlocks.some((b) =>
    contextIds.has(b.id),
  );
  const text = normalizeWhitespace(
    bodyAlreadyHasContext || prefix.length === 0
      ? options.bodyText
      : `${prefix}\n\n${options.bodyText}`,
  );

  const sourceBlockIds = options.sourceBlocks.map((b) => b.id);
  const contextBlockIds = options.contextBlocks
    .map((b) => b.id)
    .filter((id) => !sourceBlockIds.includes(id));

  const pages = uniqueSortedPages(options.sourceBlocks.map((b) => b.page));
  const contextPages = uniqueSortedPages(
    options.contextBlocks
      .filter((b) => !sourceBlockIds.includes(b.id))
      .map((b) => b.page),
  );

  const warnings = [
    ...collectWarnings([...options.sourceBlocks, ...options.contextBlocks]),
    ...(options.extraWarnings ?? []),
  ];

  const metadata: ChunkMetadata = {
    documentId: options.document.id,
    relativePath: options.document.relativePath,
    sourceHash: options.document.sourceHash,
    documentTitle: options.document.title,
    sectionPath: options.sectionPath,
    sourceBlockIds,
    contextBlockIds: contextBlockIds.length > 0 ? contextBlockIds : undefined,
    tableRowRange: options.tableRowRange,
    pages,
    contextPages,
    warnings,
    charCount: text.length,
    tokenEstimate: estimateTokens(text),
    tokenEstimateMethod: TOKEN_ESTIMATE_METHOD,
  };

  return {
    chunkId: `${options.document.id}:c${String(options.index).padStart(3, "0")}`,
    text,
    metadata,
  };
}

/** Split prose on numbered Hebrew clauses ("סעיף N – ..."). */
export function splitNumberedClauses(text: string): string[] {
  const re = /סעיף\s+\d+\s*[–-]/g;
  const starts: number[] = [];
  for (const match of text.matchAll(re)) {
    if (typeof match.index === "number") starts.push(match.index);
  }
  if (starts.length < 2) return [text];

  const parts: string[] = [];
  const preamble = text.slice(0, starts[0]).trim();
  if (preamble) parts.push(preamble);
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i]!;
    const end = i + 1 < starts.length ? starts[i + 1]! : text.length;
    const part = text.slice(start, end).trim();
    if (part) parts.push(part);
  }
  return parts;
}

function splitSentences(text: string): string[] {
  const parts = text
    .split(/(?<=[.!?。])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : [text];
}

function packUnits(
  units: string[],
  maxTokens: number,
  overlapTokens: number,
): string[] {
  if (units.length === 0) return [];
  const packed: string[] = [];
  let current: string[] = [];
  let currentTokens = 0;

  const flush = () => {
    if (current.length === 0) return;
    packed.push(current.join("\n"));
    if (overlapTokens > 0 && packed.length > 0) {
      const overlap: string[] = [];
      let overlapSize = 0;
      for (let i = current.length - 1; i >= 0; i--) {
        const unit = current[i]!;
        const t = estimateTokens(unit);
        if (overlap.length > 0 && overlapSize + t > overlapTokens) break;
        overlap.unshift(unit);
        overlapSize += t;
      }
      current = overlap;
      currentTokens = overlapSize;
    } else {
      current = [];
      currentTokens = 0;
    }
  };

  for (const unit of units) {
    const t = estimateTokens(unit);
    if (current.length > 0 && currentTokens + t > maxTokens) {
      flush();
    }
    if (t > maxTokens) {
      // Hard fallback: sentence pack oversized unit.
      const sentences = splitSentences(unit);
      for (const sentence of sentences) {
        const st = estimateTokens(sentence);
        if (current.length > 0 && currentTokens + st > maxTokens) flush();
        current.push(sentence);
        currentTokens += st;
      }
      continue;
    }
    current.push(unit);
    currentTokens += t;
  }
  if (current.length > 0) {
    packed.push(current.join("\n"));
  }
  return packed;
}

function splitProseForChunking(text: string): string[] {
  const clauses = splitNumberedClauses(text);
  if (clauses.length > 1) {
    // Keep one chunk per numbered clause for precise citation; only sub-split
    // a clause that itself exceeds the hard max.
    const out: string[] = [];
    for (const clause of clauses) {
      if (estimateTokens(clause) <= CHUNKING_POLICY.hardMaxTokens) {
        out.push(clause);
      } else {
        out.push(
          ...packUnits(
            splitSentences(clause),
            CHUNKING_POLICY.targetMaxTokens,
            CHUNKING_POLICY.overlapTokens,
          ),
        );
      }
    }
    return out;
  }
  if (estimateTokens(text) <= CHUNKING_POLICY.targetMaxTokens) {
    return [text];
  }
  const paragraphs = text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paragraphs.length > 1) {
    return packUnits(
      paragraphs,
      CHUNKING_POLICY.targetMaxTokens,
      CHUNKING_POLICY.overlapTokens,
    );
  }
  return packUnits(
    splitSentences(text),
    CHUNKING_POLICY.targetMaxTokens,
    CHUNKING_POLICY.overlapTokens,
  );
}

function defaultContextBlocks(
  doc: ParsedDocument,
  sourceBlocks: ContentBlock[],
): ContentBlock[] {
  const sourceIds = new Set(sourceBlocks.map((b) => b.id));
  return findApplicabilityBlocks(doc).filter((b) => !sourceIds.has(b.id));
}

function emitWholeDocument(
  doc: ParsedDocument,
  state: BuildState,
): void {
  const bodyBlocks = doc.blocks.filter(isSearchableBody);
  if (bodyBlocks.length === 0) {
    state.omissions.push("No searchable body blocks (headings-only or empty).");
    return;
  }

  const headingCount = doc.blocks.filter(isHeadingOnly).length;
  if (headingCount > 0) {
    state.omissions.push(
      `Folded ${headingCount} heading block(s) into title/sectionPath metadata.`,
    );
  }

  const sectionPath =
    bodyBlocks.find((b) => b.sectionPath && b.sectionPath.length > 0)
      ?.sectionPath ?? doc.blocks[0]?.sectionPath;

  const bodyText = bodyBlocks.map((b) => b.text).join("\n\n");
  state.chunks.push(
    finalizeChunk({
      document: doc,
      index: state.chunks.length,
      bodyText,
      sourceBlocks: bodyBlocks,
      contextBlocks: [],
      sectionPath,
    }),
  );
}

function emitTableSlices(
  doc: ParsedDocument,
  tableBlock: ContentBlock,
  state: BuildState,
): void {
  const table = tableBlock.table;
  if (!table) return;

  const contextBlocks = [
    ...doc.blocks.filter((b) => b.type === "heading").slice(0, 1),
    ...defaultContextBlocks(doc, [tableBlock]),
  ];

  if (!shouldSplitTable(table)) {
    state.chunks.push(
      finalizeChunk({
        document: doc,
        index: state.chunks.length,
        bodyText: tableBodyText(table, 0, table.rows.length - 1),
        sourceBlocks: [tableBlock],
        contextBlocks,
        sectionPath: tableBlock.sectionPath,
        tableRowRange: { start: 0, end: table.rows.length - 1 },
      }),
    );
    return;
  }

  const size = CHUNKING_POLICY.tableRowsPerChunk;
  for (let start = 0; start < table.rows.length; start += size) {
    const end = Math.min(start + size - 1, table.rows.length - 1);
    state.chunks.push(
      finalizeChunk({
        document: doc,
        index: state.chunks.length,
        bodyText: tableBodyText(table, start, end),
        sourceBlocks: [tableBlock],
        contextBlocks,
        sectionPath: tableBlock.sectionPath,
        tableRowRange: { start, end },
      }),
    );
  }
  state.omissions.push(
    `Split table ${tableBlock.id} into row groups of up to ${size} (headers repeated).`,
  );
}

function emitProseBlock(
  doc: ParsedDocument,
  block: ContentBlock,
  state: BuildState,
): void {
  const parts = splitProseForChunking(block.text);
  const contextBlocks = defaultContextBlocks(doc, [block]);
  for (const part of parts) {
    // Enrich sectionPath when part opens with "סעיף N – Title"
    const clauseMatch = part.match(/^(סעיף\s+\d+\s*[–-]\s*[^\n.]+)/);
    const sectionPath =
      clauseMatch && block.sectionPath
        ? [...block.sectionPath, normalizeWhitespace(clauseMatch[1]!)]
        : block.sectionPath;

    state.chunks.push(
      finalizeChunk({
        document: doc,
        index: state.chunks.length,
        bodyText: part,
        sourceBlocks: [block],
        contextBlocks,
        sectionPath,
      }),
    );
  }
}

function emitSplitDocument(doc: ParsedDocument, state: BuildState): void {
  const headingCount = doc.blocks.filter(isHeadingOnly).length;
  if (headingCount > 0) {
    state.omissions.push(
      `Folded ${headingCount} heading block(s) into title/sectionPath metadata.`,
    );
  }

  // Group consecutive non-table body blocks by sectionPath; tables handled alone.
  let i = 0;
  while (i < doc.blocks.length) {
    const block = doc.blocks[i]!;
    if (isHeadingOnly(block) || !isSearchableBody(block)) {
      i += 1;
      continue;
    }
    if (block.type === "table" && block.table) {
      emitTableSlices(doc, block, state);
      i += 1;
      continue;
    }

    const sectionKey = (block.sectionPath ?? []).join("\u0001");
    const group: ContentBlock[] = [block];
    let j = i + 1;
    while (j < doc.blocks.length) {
      const next = doc.blocks[j]!;
      if (isHeadingOnly(next)) {
        j += 1;
        continue;
      }
      if (!isSearchableBody(next)) {
        j += 1;
        continue;
      }
      if (next.type === "table") break;
      const nextKey = (next.sectionPath ?? []).join("\u0001");
      if (nextKey !== sectionKey) break;
      group.push(next);
      j += 1;
    }

    // Skip emitting a short applicability lead that will be attached as context
    // to a following oversized/split table in the same document.
    const following = doc.blocks
      .slice(j)
      .find((b) => isSearchableBody(b) && !isHeadingOnly(b));
    const leadOnlyApplicability =
      group.length > 0 &&
      group.every(
        (b) =>
          b.type === "paragraph" &&
          APPLICABILITY_RE.test(b.text) &&
          estimateTokens(b.text) <= 180,
      );
    if (
      leadOnlyApplicability &&
      following?.type === "table" &&
      following.table &&
      shouldSplitTable(following.table)
    ) {
      state.omissions.push(
        `Attached lead applicability block(s) as context on split table chunks (not as a standalone chunk).`,
      );
      i = j;
      continue;
    }

    const combined = group.map((b) => b.text).join("\n\n");
    const hasNumberedClauses = group.some(
      (b) => splitNumberedClauses(b.text).length > 1,
    );

    if (
      estimateTokens(combined) <= CHUNKING_POLICY.targetMaxTokens &&
      !hasNumberedClauses
    ) {
      state.chunks.push(
        finalizeChunk({
          document: doc,
          index: state.chunks.length,
          bodyText: combined,
          sourceBlocks: group,
          contextBlocks: defaultContextBlocks(doc, group),
          sectionPath: group[0]?.sectionPath,
        }),
      );
    } else {
      for (const body of group) {
        if (splitNumberedClauses(body.text).length > 1) {
          emitProseBlock(doc, body, state);
          continue;
        }
        if (estimateTokens(body.text) <= CHUNKING_POLICY.targetMaxTokens) {
          state.chunks.push(
            finalizeChunk({
              document: doc,
              index: state.chunks.length,
              bodyText: body.text,
              sourceBlocks: [body],
              contextBlocks: defaultContextBlocks(doc, [body]),
              sectionPath: body.sectionPath,
            }),
          );
        } else {
          emitProseBlock(doc, body, state);
        }
      }
    }
    i = j;
  }
}

function documentSearchableTokens(doc: ParsedDocument): number {
  return estimateTokens(
    doc.blocks
      .filter(isSearchableBody)
      .map((b) => b.text)
      .join("\n\n"),
  );
}

function documentNeedsSplit(doc: ParsedDocument): boolean {
  if (documentSearchableTokens(doc) > CHUNKING_POLICY.keepWholeDocumentMaxTokens) {
    return true;
  }
  return doc.blocks.some(
    (b) => b.type === "table" && b.table && shouldSplitTable(b.table),
  );
}

export function chunkDocument(doc: ParsedDocument): {
  chunks: Chunk[];
  result: DocumentChunkingResult;
} {
  const state: BuildState = { chunks: [], omissions: [], warnings: [] };

  if (doc.status === "failure" || doc.blocks.length === 0) {
    return {
      chunks: [],
      result: {
        documentId: doc.id,
        relativePath: doc.relativePath,
        status: "failure",
        chunkCount: 0,
        chunkIds: [],
        tokenEstimates: [],
        warnings: doc.warnings,
        intentionalOmissions: [],
        error: "Parsed document has failure status or no blocks.",
      },
    };
  }

  for (const warning of doc.warnings) {
    if (!state.warnings.includes(warning)) state.warnings.push(warning);
  }

  try {
    if (documentNeedsSplit(doc)) {
      emitSplitDocument(doc, state);
    } else {
      emitWholeDocument(doc, state);
    }
  } catch (error) {
    return {
      chunks: [],
      result: {
        documentId: doc.id,
        relativePath: doc.relativePath,
        status: "failure",
        chunkCount: 0,
        chunkIds: [],
        tokenEstimates: [],
        warnings: state.warnings,
        intentionalOmissions: state.omissions,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }

  if (state.chunks.length === 0) {
    return {
      chunks: [],
      result: {
        documentId: doc.id,
        relativePath: doc.relativePath,
        status: "skipped_empty",
        chunkCount: 0,
        chunkIds: [],
        tokenEstimates: [],
        warnings: state.warnings,
        intentionalOmissions: state.omissions,
        error: "No searchable chunks produced.",
      },
    };
  }

  // Flag oversized chunks (allowed for indivisible units like dense tables).
  for (const chunk of state.chunks) {
    if (chunk.metadata.tokenEstimate > CHUNKING_POLICY.targetMaxTokens) {
      const msg = `Chunk ${chunk.chunkId} exceeds target (${chunk.metadata.tokenEstimate} > ${CHUNKING_POLICY.targetMaxTokens}).`;
      if (!chunk.metadata.warnings.includes(msg)) {
        chunk.metadata.warnings.push(msg);
      }
      if (!state.warnings.includes(msg)) state.warnings.push(msg);
    }
  }

  // Intentional omissions (e.g. folding headings into metadata) are documented
  // but do not by themselves mark the document as warning-quality.
  const status =
    state.warnings.length > 0 ? "success_with_warnings" : "success";

  return {
    chunks: state.chunks,
    result: {
      documentId: doc.id,
      relativePath: doc.relativePath,
      status,
      chunkCount: state.chunks.length,
      chunkIds: state.chunks.map((c) => c.chunkId),
      tokenEstimates: state.chunks.map((c) => c.metadata.tokenEstimate),
      warnings: state.warnings,
      intentionalOmissions: state.omissions,
    },
  };
}
