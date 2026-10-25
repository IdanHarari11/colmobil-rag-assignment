import type { Root, Content, List, Table } from "mdast";
import { toString } from "mdast-util-to-string";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import type { ContentBlock, ParsedDocument } from "./types";
import {
  assignSectionPaths,
  buildTableData,
  documentIdFromPath,
  normalizeWhitespace,
  sha256,
  stripHtmlComments,
  withBlockIds,
} from "./utils";

function listItems(node: List): string[] {
  return node.children.map((item) => normalizeWhitespace(toString(item)));
}

function tableFromMdast(node: Table): ReturnType<typeof buildTableData> {
  const rows = node.children.map((row) =>
    row.children.map((cell) => normalizeWhitespace(toString(cell))),
  );
  const headers = rows[0] ?? [];
  const body = rows.slice(1);
  return buildTableData(headers, body, { structureInferred: false });
}

function walk(nodes: Content[]): Omit<ContentBlock, "id">[] {
  const blocks: Omit<ContentBlock, "id">[] = [];

  for (const node of nodes) {
    switch (node.type) {
      case "heading": {
        const text = normalizeWhitespace(toString(node));
        if (!text) break;
        blocks.push({ type: "heading", level: node.depth, text });
        break;
      }
      case "paragraph": {
        const text = normalizeWhitespace(toString(node));
        if (!text) break;
        blocks.push({ type: "paragraph", text });
        break;
      }
      case "list": {
        const items = listItems(node).filter(Boolean);
        if (items.length === 0) break;
        blocks.push({
          type: "list",
          ordered: Boolean(node.ordered),
          listItems: items,
          text: items.map((item, i) =>
            node.ordered ? `${i + 1}. ${item}` : `- ${item}`,
          ).join("\n"),
        });
        break;
      }
      case "table": {
        const table = tableFromMdast(node);
        blocks.push({
          type: "table",
          table,
          text: [table.caption, table.textRepresentation]
            .filter(Boolean)
            .join("\n"),
        });
        break;
      }
      case "blockquote": {
        const text = normalizeWhitespace(toString(node));
        if (text) blocks.push({ type: "paragraph", text });
        break;
      }
      case "thematicBreak":
        break;
      default:
        if ("children" in node && Array.isArray(node.children)) {
          blocks.push(...walk(node.children as Content[]));
        }
        break;
    }
  }

  return blocks;
}

export function parseMarkdownDocument(
  relativePath: string,
  source: string,
): ParsedDocument {
  const id = documentIdFromPath(relativePath);
  const warnings: string[] = [];
  const { text: withoutComments, removedCount } = stripHtmlComments(source);
  if (removedCount > 0) {
    warnings.push(
      `Removed ${removedCount} HTML comment(s) from searchable Markdown text.`,
    );
  }

  const tree = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .parse(withoutComments) as Root;

  const rawBlocks = walk(tree.children);
  const blocks = withBlockIds(id, rawBlocks);
  assignSectionPaths(blocks);

  const title =
    blocks.find((b) => b.type === "heading")?.text ??
    relativePath.split("/").pop();

  return {
    id,
    relativePath,
    format: "md",
    sourceHash: sha256(source),
    title,
    blocks,
    warnings,
    status: warnings.length > 0 ? "success_with_warnings" : "success",
  };
}
