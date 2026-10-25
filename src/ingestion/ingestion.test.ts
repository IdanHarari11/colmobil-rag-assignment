import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ContentBlock, ParsedDocument } from "./types";
import { parseCorpusFile } from "./index";
import { parseMarkdownDocument } from "./parse-markdown";

const ROOT = process.cwd();

async function parseRelative(relativeUnderCorpus: string) {
  const absolutePath = path.join(ROOT, "corpus", relativeUnderCorpus);
  return parseCorpusFile(
    absolutePath,
    path.posix.join("corpus", relativeUnderCorpus),
  );
}

function formsCatalogTable(doc: ParsedDocument): ContentBlock {
  const table = doc.blocks.find(
    (b) =>
      b.type === "table" &&
      b.table?.rows.some((row) => row.some((cell) => /\b4401\b/.test(cell))),
  );
  if (!table?.table) {
    throw new Error("forms catalog table not found");
  }
  return table;
}

function rowContaining(table: ContentBlock, pattern: RegExp): string[] {
  const row = table.table!.rows.find((r) => r.some((cell) => pattern.test(cell)));
  if (!row) {
    throw new Error(`row not found for ${pattern}`);
  }
  return row;
}

describe("ingestion sensitive content", () => {
  it("keeps 2026 applicability and 2024 continuity terms with spaced tokens", async () => {
    const doc = await parseRelative("02_car_comprehensive_policy_2026.pdf");
    expect(doc.status).not.toBe("failure");
    const blob = doc.blocks.map((b) => b.text).join("\n");
    expect(blob).toMatch(/1\.3\.2026/);
    expect(blob).toMatch(/2024/);
    expect(blob).toMatch(/חידוש/);
    // Gap-based spacing from text positions — not glued Hebrew/date tokens.
    expect(blob).toMatch(/לפני\s+1\.3\.2026\s+ממשיכות/);
    expect(blob).not.toMatch(/לפני1\.3\.2026ממשיכות/);
  });

  it("keeps deductible table values and multi-line cell assignment", async () => {
    const doc = await parseRelative("02_car_comprehensive_policy_2026.pdf");
    const table = doc.blocks.find(
      (b) => b.type === "table" && b.table?.textRepresentation.includes("1,100"),
    );
    expect(table).toBeTruthy();
    const rows = table!.table!.rows;

    const garage = rows.find((r) => r.some((c) => /מוסך שאינו/.test(c)));
    expect(garage).toBeTruthy();
    expect(garage!.join(" ")).toMatch(/בהסדר/);
    expect(garage!.join(" ")).toMatch(/2,100/);
    // Continuation "בהסדר" must stay on the same row, not become its own row.
    expect(rows.filter((r) => r.join(" ").trim() === "בהסדר").length).toBe(0);

    const theft = rows.find((r) => r.some((c) => /גניבה|אובדן גמור/.test(c)));
    expect(theft).toBeTruthy();
    expect(theft!.join(" ")).toMatch(/5%/);
    expect(theft!.join(" ")).toMatch(/3,000/);
    expect(theft!.join(" ")).toMatch(/מערך הרכב/);

    const glass = rows.find((r) => r.some((c) => /שמשות/.test(c)));
    expect(glass).toBeTruthy();
    expect(glass!.join(" ")).toMatch(/כתב שירות/);
    // Index prose after the table must not be absorbed into the glass row.
    expect(glass!.join(" ")).not.toMatch(/צמודה למדד/);
  });

  it("merges multi-line forms catalog cells for 4401 and peer rows", async () => {
    const doc = await parseRelative("20_forms_catalog.pdf");
    const table = formsCatalogTable(doc);
    expect(table).toBeTruthy();
    expect(table!.table!.extractionIncomplete).not.toBe(true);

    const dataRows = table!.table!.rows;
    // One logical row per form ID — no orphan continuation rows.
    const formIds = dataRows
      .map((r) => r[0]?.match(/^\d{4}$/)?.[0])
      .filter(Boolean);
    expect(formIds).toEqual([
      "1001",
      "1003",
      "1007",
      "2010",
      "2015",
      "3002",
      "3005",
      "4401",
      "4410",
      "4420",
      "4425",
      "5001",
    ]);
    expect(dataRows.length).toBe(12);
    expect(dataRows.every((r) => /^\d{4}$/.test(r[0] ?? ""))).toBe(true);

    const row4401 = rowContaining(table, /\b4401\b/);
    expect(row4401[0]).toBe("4401");
    expect(row4401[1]).toMatch(/בקשה לביטול\s+פוליסה/);
    expect(row4401[2]).toMatch(/ביטול פוליסה\s+ביוזמת הלקוח/);
    expect(row4401[3]).toBe("כללי");
    expect(row4401[4]).toMatch(/אזור אישי\s*\/\s*מוקד/);

    const row1001 = rowContaining(table, /\b1001\b/);
    expect(row1001[1]).toMatch(/הודעה על\s+תאונת רכב/);
    expect(row1001[2]).toMatch(/דיווח על תאונה\s+או נזק לרכב/);
    expect(row1001[4]).toMatch(/אזור אישי\s*\/\s*מוקד/);

    const row3002 = rowContaining(table, /\b3002\b/);
    expect(row3002[1]).toMatch(/הצהרת בריאות\s+לנוסע/);
    expect(row3002[2]).toMatch(/מצב רפואי\s+קודם,\s*נוסע\s+מגיל\s*75/);

    const row4410 = rowContaining(table, /\b4410\b/);
    expect(row4410[0]).toBe("4410");
    expect(row4410[1]).toMatch(/פרטי חשבון בנק\s+להחזר/);
    expect(row4410[2]).toMatch(/עדכון חשבון\s+לקבלת החזר או\s+תגמולים/);
  });

  it("keeps cash row from home contents limits table", async () => {
    const doc = await parseRelative("12_home_contents_limits.docx");
    expect(doc.status).not.toBe("failure");
    const table = doc.blocks.find((b) => b.type === "table");
    expect(table).toBeTruthy();
    const cash = table!.table!.rows.find((row) =>
      row.some((c) => /מזומנים/.test(c)),
    );
    expect(cash?.join(" ")).toMatch(/2,000/);
    expect(table!.table!.textRepresentation).toMatch(/מזומנים/);
  });

  it("keeps earthquake annex rows including TAM״A 38 multi-line cell", async () => {
    const doc = await parseRelative("13_home_earthquake_annex.pdf");
    const blob = doc.blocks.map((b) => b.text).join("\n");
    expect(blob).toMatch(/סכום ביטוח המבנה/);
    expect(blob).toMatch(/סכום הנזק לתכולה/);

    const table = doc.blocks.find(
      (b) => b.type === "table" && b.table?.textRepresentation.includes("10%"),
    );
    expect(table).toBeTruthy();
    const tama = table!.table!.rows.find((r) =>
      r.some((c) => /חיזוק|תמ/.test(c)),
    );
    expect(tama).toBeTruthy();
    expect(tama!.join(" ")).toMatch(/תמ[”"]?א\s*38|38\s*תמ/);
    expect(tama!.join(" ")).toMatch(/5%/);
    expect(tama!.join(" ")).toMatch(/סכום ביטוח המבנה/);
    // Continuation must not be a separate orphan row.
    expect(
      table!.table!.rows.filter((r) => /^38\s*תמ|^תמ[”"]?א\s*38$/.test(r.join(" ").trim()))
        .length,
    ).toBe(0);
  });

  it("keeps luggage delay table and PIR condition from markdown", async () => {
    const source = await readFile(
      path.join(ROOT, "corpus/16_travel_luggage.md"),
      "utf8",
    );
    const doc = parseMarkdownDocument("corpus/16_travel_luggage.md", source);
    const table = doc.blocks.find((b) => b.type === "table");
    expect(table?.table?.rows.some((r) => r.join(" ").includes("6"))).toBe(
      true,
    );
    expect(table?.table?.textRepresentation).toMatch(/150/);
    const blob = doc.blocks.map((b) => b.text).join("\n");
    expect(blob).toMatch(/PIR/);
  });

  it("strips HTML comments from markdown searchable text", () => {
    const doc = parseMarkdownDocument(
      "corpus/09_marketing_brochure_car.md",
      [
        "# Title",
        "",
        "Visible text.",
        "<!-- secret instruction -->",
        "",
        "More text.",
      ].join("\n"),
    );
    const blob = doc.blocks.map((b) => b.text).join("\n");
    expect(blob).not.toMatch(/secret instruction/);
    expect(doc.warnings.some((w) => /HTML comment/i.test(w))).toBe(true);
  });
});
