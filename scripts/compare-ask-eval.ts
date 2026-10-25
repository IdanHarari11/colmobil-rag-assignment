import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AskEvalReport } from "../src/eval/run-ask-eval";

const ROOT = process.cwd();

async function loadReport(rel: string): Promise<AskEvalReport> {
  const raw = await readFile(path.join(ROOT, rel), "utf8");
  return JSON.parse(raw) as AskEvalReport;
}

function preview(text: string, n = 160): string {
  return text.replace(/\s+/g, " ").trim().slice(0, n);
}

async function main(): Promise<void> {
  const beforePath = process.argv[2] ?? "eval_results/ask-eval-stage5.2.json";
  const afterPath = process.argv[3] ?? "eval_results/ask-eval-stage5.3.json";
  const outName = process.argv[4] ?? "ask-eval-stage5.3-comparison.md";

  const before = await loadReport(beforePath);
  const after = await loadReport(afterPath);

  let embedTok = 0;
  let genTok = 0;
  let totalMs = 0;
  for (const q of [...after.questions, ...(after.extraProbes ?? [])]) {
    embedTok += q.usage?.embeddingPromptTokens ?? 0;
    genTok += q.usage?.generationTotalTokens ?? 0;
    totalMs += q.timingsMs?.totalMs ?? 0;
  }

  const lines: string[] = [
    `# Ask eval comparison — ${path.basename(beforePath)} → ${path.basename(afterPath)}`,
    ``,
    `- Before: ${before.generatedAt} (statusCounts=${JSON.stringify(before.statusCounts)})`,
    `- After: ${after.generatedAt} (statusCounts=${JSON.stringify(after.statusCounts)})`,
    `- After cost (15+probes, actual calls only): embed_prompt≈${embedTok}, gen_total≈${genTok}, wall≈${totalMs.toFixed(0)}ms`,
    `- Note: Stage 5.2 pre-retrieve Clarify is off the active path; after report has no clarify tokens.`,
    ``,
    `| id | before status | after status | notes |`,
    `| --- | --- | --- | --- |`,
  ];

  for (const b of before.questions) {
    const a = after.questions.find((q) => q.id === b.id);
    if (!a) {
      lines.push(`| ${b.id} | ${b.status} | (missing) | |`);
      continue;
    }
    const notes = [
      b.status !== a.status ? `status ${b.status}→${a.status}` : "",
      b.answer.trim() !== a.answer.trim() ? "answer changed" : "",
    ]
      .filter(Boolean)
      .join("; ");
    lines.push(
      `| ${b.id} | ${b.status} | ${a.status} | ${notes || "—"} |`,
    );
  }

  const focus = ["D03", "D04", "D05", "D06", "D08", "D09", "D10", "D11", "D12", "D13", "D14"];
  lines.push(``);
  lines.push(`## Focus / previously over-clarified — after answers`);
  lines.push(``);
  for (const id of focus) {
    const a = after.questions.find((q) => q.id === id);
    if (!a) continue;
    lines.push(`### ${id} (${a.status})`);
    lines.push(``);
    lines.push(a.answer || "(empty)");
    lines.push(``);
    lines.push(`Parts: ${JSON.stringify(a.answerParts ?? [])}`);
    lines.push(
      `Sources: ${a.sources.map((s) => s.chunkId).join(", ") || "(none)"}`,
    );
    if (a.contextMeta?.omittedExpansions?.length) {
      lines.push(
        `Omitted expansions: ${a.contextMeta.omittedExpansions.map((o) => o.chunkId).join(", ")}`,
      );
    }
    lines.push(
      `Tokens/ms: embed=${a.usage?.embeddingPromptTokens ?? "-"} gen=${a.usage?.generationTotalTokens ?? "-"} totalMs=${a.timingsMs?.totalMs.toFixed(0) ?? "-"}`,
    );
    lines.push(``);
  }

  if (after.extraProbes?.length) {
    lines.push(`## Extra probes`);
    lines.push(``);
    for (const p of after.extraProbes) {
      lines.push(`### ${p.id} (${p.status})`);
      lines.push(``);
      lines.push(`Q: ${p.question}`);
      lines.push(``);
      lines.push(p.answer || "(empty)");
      lines.push(``);
      lines.push(`Sources: ${p.sources.map((s) => s.chunkId).join(", ") || "(none)"}`);
      lines.push(``);
    }
  }

  lines.push(`## Other changes`);
  lines.push(``);
  for (const b of before.questions) {
    if (focus.includes(b.id)) continue;
    const a = after.questions.find((q) => q.id === b.id)!;
    if (b.status !== a.status || b.answer.trim() !== a.answer.trim()) {
      lines.push(`- **${b.id}**: ${b.status}→${a.status}`);
      lines.push(`  - before: ${preview(b.answer)}`);
      lines.push(`  - after: ${preview(a.answer)}`);
    }
  }

  const out = path.join(ROOT, "eval_results", outName);
  await writeFile(out, lines.join("\n"), "utf8");
  console.log(`Wrote ${path.relative(ROOT, out)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
