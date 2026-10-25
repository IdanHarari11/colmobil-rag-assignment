import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ParsedDocument } from "../ingestion/types";
import {
  chunkDocument,
  chunkParsedDocuments,
  estimateTokens,
  loadParsedDocuments,
  splitNumberedClauses,
} from "./index";

const ROOT = process.cwd();
const PARSED_DIR = path.join(ROOT, "data", "parsed");

async function loadParsed(name: string): Promise<ParsedDocument> {
  const raw = await readFile(path.join(PARSED_DIR, name), "utf8");
  return JSON.parse(raw) as ParsedDocument;
}

describe("chunking", () => {
  it("estimates tokens as a positive heuristic (not a model tokenizer)", () => {
    const text = "פוליסות שהונפקו או חודשו לפני 1.3.2026 ממשיכות לפעול";
    const tokens = estimateTokens(text);
    expect(tokens).toBeGreaterThan(5);
    expect(tokens).toBeLessThan(40);
  });

  it("splits numbered Hebrew clauses without dropping preamble", () => {
    const text = [
      "מהדורה 7 חלים על כל פוליסות הרכב.",
      "סעיף 1 – מבוא טקסט ראשון.",
      "סעיף 2 – נהג מורשה הגדרה.",
    ].join(" ");
    const parts = splitNumberedClauses(text);
    expect(parts.length).toBe(3);
    expect(parts[0]).toMatch(/מהדורה 7/);
    expect(parts[1]).toMatch(/^סעיף 1/);
    expect(parts[2]).toMatch(/^סעיף 2/);
  });

  it("keeps a short coherent document as a single chunk", async () => {
    const doc = await loadParsed("26_address_change.json");
    const { chunks, result } = chunkDocument(doc);
    expect(result.status).not.toBe("failure");
    expect(chunks.length).toBe(1);
    expect(chunks[0]!.metadata.documentId).toBe(doc.id);
    expect(chunks[0]!.metadata.sourceHash).toBe(doc.sourceHash);
    expect(chunks[0]!.text.length).toBeGreaterThan(0);
  });

  it("preserves luggage delay table and PIR condition together for short doc", async () => {
    const doc = await loadParsed("16_travel_luggage.json");
    const { chunks } = chunkDocument(doc);
    expect(chunks.length).toBe(1);
    const text = chunks[0]!.text;
    expect(text).toMatch(/מעל 6 שעות/);
    expect(text).toMatch(/150/);
    expect(text).toMatch(/PIR/);
    expect(chunks[0]!.metadata.sourceBlockIds.length).toBeGreaterThan(1);
  });

  it("keeps 2026 applicability with the deductible table in one short-doc chunk", async () => {
    const doc = await loadParsed("02_car_comprehensive_policy_2026.json");
    const { chunks } = chunkDocument(doc);
    expect(chunks.length).toBe(1);
    const chunk = chunks[0]!;
    expect(chunk.text).toMatch(/1\.3\.2026/);
    expect(chunk.text).toMatch(/1,100/);
    expect(chunk.text).toMatch(/2,100/);
    expect(chunk.text).toMatch(/השתתפות/);
    expect(chunk.metadata.sourceBlockIds.some((id) => id.endsWith(":b001"))).toBe(
      true,
    );
    expect(chunk.metadata.sourceBlockIds.some((id) => id.endsWith(":b007"))).toBe(
      true,
    );
  });

  it("splits forms catalog table with repeated headers and row ranges", async () => {
    const doc = await loadParsed("20_forms_catalog.json");
    const { chunks, result } = chunkDocument(doc);
    const tableChunks = chunks.filter((c) => c.metadata.tableRowRange);
    expect(tableChunks.length).toBeGreaterThanOrEqual(2);
    expect(result.intentionalOmissions.some((o) => /Split table/i.test(o))).toBe(
      true,
    );

    for (const chunk of tableChunks) {
      expect(chunk.text).toMatch(/מספר טופס:/);
      expect(chunk.text).toMatch(/שם הטופס:/);
      expect(chunk.text).toMatch(/ערוץ הגשה:/);
      expect(chunk.metadata.tableRowRange).toBeTruthy();
      expect(chunk.metadata.sourceBlockIds.length).toBe(1);
      // Applicability / title come from other blocks — recorded separately.
      expect(chunk.metadata.contextBlockIds?.length).toBeGreaterThan(0);
      expect(chunk.text).toMatch(/מעודכן לספטמבר 2026|מסמך:/);
    }

    const coveredRows = new Set<number>();
    for (const chunk of tableChunks) {
      const range = chunk.metadata.tableRowRange!;
      for (let i = range.start; i <= range.end; i++) coveredRows.add(i);
    }
    expect(coveredRows.size).toBe(12);
  });

  it("keeps authorized-driver definition and referring exception with linkable ids", async () => {
    const doc = await loadParsed("03_car_general_terms.json");
    const { chunks } = chunkDocument(doc);
    expect(chunks.length).toBeGreaterThan(1);

    const definition = chunks.find(
      (c) =>
        /סעיף 2\s*[–-]/.test(c.text) &&
        /“נהג מורשה”|נהג מורשה”/.test(c.text) &&
        /רשימת הנהגים/.test(c.text),
    );
    const referring = chunks.find((c) =>
      /כהגדרתו בסעיף\s*2/.test(c.text),
    );

    expect(definition).toBeTruthy();
    expect(referring).toBeTruthy();
    expect(definition!.chunkId).not.toBe(referring!.chunkId);
    expect(definition!.metadata.documentId).toBe(referring!.metadata.documentId);
    expect(definition!.metadata.sourceBlockIds.length).toBeGreaterThan(0);
    expect(referring!.metadata.sourceBlockIds.length).toBeGreaterThan(0);
    expect(definition!.metadata.pages).toEqual([1]);
    expect(referring!.metadata.pages).toEqual([2]);
  });

  it("covers all parsed documents with unique stable chunk ids", async () => {
    const docs = await loadParsedDocuments(PARSED_DIR);
    expect(docs.length).toBe(33);
    const first = chunkParsedDocuments(docs);
    const second = chunkParsedDocuments(docs);

    expect(first.chunks.length).toBe(second.chunks.length);
    expect(first.chunks.map((c) => c.chunkId)).toEqual(
      second.chunks.map((c) => c.chunkId),
    );
    expect(first.chunks.map((c) => c.text)).toEqual(
      second.chunks.map((c) => c.text),
    );

    const ids = new Set(first.chunks.map((c) => c.chunkId));
    expect(ids.size).toBe(first.chunks.length);
    expect(first.chunks.every((c) => c.text.trim().length > 0)).toBe(true);

    const represented = new Set(first.report.documents.map((d) => d.documentId));
    expect(represented.size).toBe(33);
    expect(first.report.failureCount).toBe(0);
    expect(first.report.skippedEmptyCount).toBe(0);
  });
});
