import mammoth from "mammoth";
import { type HTMLElement, parse as parseHtml } from "node-html-parser";
import type { ContentBlock, ParsedDocument } from "./types";
import {
  assignSectionPaths,
  buildTableData,
  documentIdFromPath,
  normalizeWhitespace,
  sha256,
  withBlockIds,
} from "./utils";

function cellText(cell: HTMLElement): string {
  const parts = cell.querySelectorAll("p").map((p) => p.text.trim());
  if (parts.length > 0) return normalizeWhitespace(parts.join(" "));
  return normalizeWhitespace(cell.text);
}

function blocksFromHtml(html: string): {
  blocks: Omit<ContentBlock, "id">[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const root = parseHtml(`<div id="docx-root">${html}</div>`);
  const container = root.querySelector("#docx-root");
  const blocks: Omit<ContentBlock, "id">[] = [];
  let pendingCaption: string | undefined;

  if (!container) {
    return { blocks, warnings: ["Failed to parse DOCX HTML wrapper."] };
  }

  for (const node of container.childNodes) {
    if (!(node instanceof Object) || !("tagName" in node) || !node.tagName) {
      continue;
    }
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();

    if (/^h[1-6]$/.test(tag)) {
      const level = Number(tag.slice(1));
      const text = normalizeWhitespace(el.text);
      if (!text) continue;
      blocks.push({ type: "heading", level, text });
      pendingCaption = text;
      continue;
    }

    if (tag === "p") {
      const text = normalizeWhitespace(el.text);
      if (!text) continue;
      blocks.push({ type: "paragraph", text });
      continue;
    }

    if (tag === "ul" || tag === "ol") {
      const items = el
        .querySelectorAll("li")
        .map((li) => normalizeWhitespace(li.text))
        .filter(Boolean);
      if (items.length === 0) continue;
      const ordered = tag === "ol";
      blocks.push({
        type: "list",
        ordered,
        listItems: items,
        text: items
          .map((item, i) => (ordered ? `${i + 1}. ${item}` : `- ${item}`))
          .join("\n"),
      });
      continue;
    }

    if (tag === "table") {
      const headerCells = el.querySelectorAll("thead th, thead td");
      const bodyRows = el.querySelectorAll("tbody tr");
      const allRows = el.querySelectorAll("tr");

      let headers: string[] = [];
      let dataRows: string[][] = [];

      if (headerCells.length > 0) {
        headers = headerCells.map((cell) => cellText(cell));
        dataRows = bodyRows.map((row) =>
          row.querySelectorAll("th, td").map((cell) => cellText(cell)),
        );
      } else if (allRows.length > 0) {
        headers = allRows[0]!.querySelectorAll("th, td").map((cell) =>
          cellText(cell),
        );
        dataRows = allRows.slice(1).map((row) =>
          row.querySelectorAll("th, td").map((cell) => cellText(cell)),
        );
        warnings.push(
          "DOCX table had no <thead>; first row treated as headers.",
        );
      }

      if (headers.length === 0) {
        warnings.push("DOCX table could not be structured; skipped.");
        continue;
      }

      const table = buildTableData(headers, dataRows, {
        caption: pendingCaption,
        structureInferred: false,
      });
      blocks.push({
        type: "table",
        table,
        text: [table.caption, table.textRepresentation]
          .filter(Boolean)
          .join("\n"),
      });
      pendingCaption = undefined;
    }
  }

  return { blocks, warnings };
}

export async function parseDocxDocument(
  relativePath: string,
  buffer: Buffer,
): Promise<ParsedDocument> {
  const id = documentIdFromPath(relativePath);
  const warnings: string[] = [];

  const htmlResult = await mammoth.convertToHtml(
    { buffer },
    {
      styleMap: [
        "p[style-name='Heading 1'] => h1:fresh",
        "p[style-name='Heading 2'] => h2:fresh",
        "p[style-name='Heading 3'] => h3:fresh",
      ],
    },
  );

  for (const message of htmlResult.messages) {
    warnings.push(`mammoth: ${message.message}`);
  }

  const { blocks: rawBlocks, warnings: htmlWarnings } = blocksFromHtml(
    htmlResult.value,
  );
  warnings.push(...htmlWarnings);

  if (rawBlocks.length === 0) {
    const raw = await mammoth.extractRawText({ buffer });
    const text = normalizeWhitespace(raw.value);
    if (text) {
      rawBlocks.push({ type: "paragraph", text });
      warnings.push(
        "Falling back to raw DOCX text; structured HTML blocks were empty.",
      );
    }
  }

  const blocks = withBlockIds(id, rawBlocks);
  assignSectionPaths(blocks);
  const title =
    blocks.find((b) => b.type === "heading")?.text ??
    relativePath.split("/").pop();

  return {
    id,
    relativePath,
    format: "docx",
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
