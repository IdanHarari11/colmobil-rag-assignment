import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Embedder } from "../rag/embedder";
import { loadValidatedIndex } from "../rag/index-store";
import { defaultChunksPath, defaultEvalDir, defaultIndexPath } from "../rag/paths";
import { retrieve, type RetrieveDependencies } from "../rag/retrieve";
import type { RetrievalHit, RetrieveMode } from "../rag/types";
import {
  documentRecallAtK,
  mean,
  reciprocalRank,
} from "./retrieval-metrics";

export interface DevQuestion {
  id: string;
  category: string;
  question: string;
  reference_answer: string;
  sources: string[];
}

export interface RetrievalEvalHitSnapshot {
  chunkId: string;
  documentId: string;
  relativePath: string;
  sectionPath?: string[];
  pages?: number[];
  score: number;
  text: string;
  warnings: string[];
}

export interface RetrievalEvalQuestionResult {
  id: string;
  category: string;
  question: string;
  referenceSources: string[];
  metrics: {
    documentRecallAt1: number | "N/A";
    documentRecallAt3: number | "N/A";
    documentRecallAt5: number | "N/A";
    reciprocalRank: number | "N/A";
  };
  timingsMs: {
    questionEmbeddingMs: number;
    localSearchMs: number;
  };
  usage?: {
    promptTokens?: number;
    totalTokens?: number;
  };
  topHits: RetrievalEvalHitSnapshot[];
  reviewNotes: string[];
}

export interface RetrievalEvalReport {
  generatedAt: string;
  /** Retrieval mode used for this report (default vector when omitted historically). */
  mode: RetrieveMode;
  model: string;
  dimensions: number;
  topK: number;
  /** Metric denominator: Document Recall over reference *documents* in top-K *chunks*. */
  metricDenominator: string;
  index?: {
    path: string;
    chunksInputHash?: string;
    embeddingTextHash?: string;
    chunkCount?: number;
  };
  questionCount: number;
  scoredQuestionCount: number;
  noReferenceQuestionIds: string[];
  averages: {
    documentRecallAt1: number | null;
    documentRecallAt3: number | null;
    documentRecallAt5: number | null;
    mrr: number | null;
  };
  totalUsage?: {
    promptTokens: number;
    totalTokens: number;
  };
  disclaimer: string;
  questions: RetrievalEvalQuestionResult[];
}

function snapshotHit(hit: RetrievalHit): RetrievalEvalHitSnapshot {
  return {
    chunkId: hit.chunkId,
    documentId: hit.documentId,
    relativePath: hit.relativePath,
    sectionPath: hit.sectionPath,
    pages: hit.pages,
    score: hit.score,
    text: hit.text,
    warnings: hit.warnings,
  };
}

function metricOrNA(value: number | null): number | "N/A" {
  return value === null ? "N/A" : value;
}

function reviewNotesForQuestion(q: DevQuestion): string[] {
  const notes: string[] = [];
  if (q.sources.length === 0) {
    notes.push(
      "No reference sources: source-match metrics are N/A. Returning chunks is not a failure at the retrieval stage.",
    );
  }
  if (q.category === "ambiguous") {
    notes.push(
      "Ambiguous question: multiple valid documents may exist; automatic document recall is not a full answer-quality judgment.",
    );
  }
  if (q.category === "conflict") {
    notes.push(
      "Conflict/marketing vs binding terms: document match alone does not prove the binding clause was ranked above marketing copy.",
    );
  }
  if (q.category === "cross_lingual") {
    notes.push(
      "Cross-lingual: reference sources may be incomplete; a valid Hebrew alternative source can still answer the question.",
    );
  }
  if (q.category === "multi_hop") {
    notes.push(
      "Multi-hop: document recall does not guarantee both definition and exception chunks were retrieved.",
    );
  }
  notes.push(
    "Document match ≠ proof that the retrieved section contains the answer span.",
  );
  return notes;
}

export async function loadDevQuestions(
  devSetPath: string,
): Promise<DevQuestion[]> {
  const raw = await readFile(devSetPath, "utf8");
  const parsed = JSON.parse(raw) as DevQuestion[];
  if (!Array.isArray(parsed)) {
    throw new Error(`Invalid dev set: ${devSetPath}`);
  }
  return parsed;
}

export async function runRetrievalEval(options: {
  devSetPath: string;
  topK?: number;
  /** Defaults to vector — same as retrieve() when mode is omitted. */
  mode?: RetrieveMode;
  deps?: RetrieveDependencies;
  embedder?: Embedder;
}): Promise<RetrievalEvalReport> {
  const questions = await loadDevQuestions(options.devSetPath);
  const topK = options.topK ?? 5;
  const mode: RetrieveMode = options.mode ?? "vector";
  const index =
    options.deps?.index ??
    (await loadValidatedIndex({
      chunksPath: defaultChunksPath(),
      indexPath: defaultIndexPath(),
    }));
  const deps: RetrieveDependencies = {
    ...options.deps,
    index,
    embedder: options.embedder ?? options.deps?.embedder,
  };

  const results: RetrievalEvalQuestionResult[] = [];
  let promptTokens = 0;
  let totalTokens = 0;
  let model = "";
  let dimensions = 0;

  for (const question of questions) {
    const retrieved = await retrieve(question.question, { topK, mode }, deps);
    model = retrieved.model;
    dimensions = retrieved.dimensions;
    promptTokens += retrieved.usage?.promptTokens ?? 0;
    totalTokens += retrieved.usage?.totalTokens ?? 0;

    const recall1 = documentRecallAtK(retrieved.hits, question.sources, 1);
    const recall3 = documentRecallAtK(retrieved.hits, question.sources, 3);
    const recall5 = documentRecallAtK(retrieved.hits, question.sources, 5);
    const rr = reciprocalRank(retrieved.hits, question.sources);

    results.push({
      id: question.id,
      category: question.category,
      question: question.question,
      referenceSources: question.sources,
      metrics: {
        documentRecallAt1: metricOrNA(recall1),
        documentRecallAt3: metricOrNA(recall3),
        documentRecallAt5: metricOrNA(recall5),
        reciprocalRank: metricOrNA(rr),
      },
      timingsMs: retrieved.timingsMs,
      usage: retrieved.usage,
      topHits: retrieved.hits.map(snapshotHit),
      reviewNotes: reviewNotesForQuestion(question),
    });
  }

  const scored = results.filter((r) => r.referenceSources.length > 0);
  const avg = {
    documentRecallAt1: mean(
      scored.map((r) => r.metrics.documentRecallAt1 as number),
    ),
    documentRecallAt3: mean(
      scored.map((r) => r.metrics.documentRecallAt3 as number),
    ),
    documentRecallAt5: mean(
      scored.map((r) => r.metrics.documentRecallAt5 as number),
    ),
    mrr: mean(scored.map((r) => r.metrics.reciprocalRank as number)),
  };

  return {
    generatedAt: new Date().toISOString(),
    mode,
    model,
    dimensions,
    topK,
    metricDenominator:
      "Document Recall / MRR: reference documents appearing among top-K retrieved chunks (not answer correctness).",
    index: {
      path: "data/index/embeddings.json",
      chunksInputHash: index.manifest.chunksInputHash,
      embeddingTextHash: index.manifest.embeddingTextHash,
      chunkCount: index.manifest.chunkCount,
    },
    questionCount: results.length,
    scoredQuestionCount: scored.length,
    noReferenceQuestionIds: results
      .filter((r) => r.referenceSources.length === 0)
      .map((r) => r.id),
    averages: avg,
    totalUsage:
      promptTokens > 0 || totalTokens > 0
        ? { promptTokens, totalTokens }
        : undefined,
    disclaimer:
      "Document Recall measures whether a reference document appears among top-K chunks. It does not prove the answer span was retrieved. Similarity scores are not confidence. No-answer / ambiguous / alternate-valid-source cases need separate human review. Do not compare this report to a different retrieval mode without labeling both.",
    questions: results,
  };
}

export function formatRetrievalEvalMarkdown(report: RetrievalEvalReport): string {
  const lines: string[] = [];
  lines.push("# Retrieval evaluation report");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(
    `Mode: **${report.mode}** | Model: ${report.model} (dims=${report.dimensions}), topK=${report.topK}`,
  );
  lines.push(`Metric: ${report.metricDenominator}`);
  if (report.index?.embeddingTextHash) {
    lines.push(
      `Index: chunks=${report.index.chunkCount ?? "?"} embeddingTextHash=${report.index.embeddingTextHash.slice(0, 12)}… chunksInputHash=${(report.index.chunksInputHash ?? "").slice(0, 12)}…`,
    );
  }
  lines.push("");
  lines.push("## Averages (questions with reference sources only)");
  lines.push("");
  lines.push(
    `| Document Recall@1 | Document Recall@3 | Document Recall@5 | MRR |`,
  );
  lines.push(`| --- | --- | --- | --- |`);
  lines.push(
    `| ${fmt(report.averages.documentRecallAt1)} | ${fmt(report.averages.documentRecallAt3)} | ${fmt(report.averages.documentRecallAt5)} | ${fmt(report.averages.mrr)} |`,
  );
  lines.push("");
  if (report.totalUsage) {
    lines.push(
      `API usage (questions): prompt_tokens=${report.totalUsage.promptTokens}, total_tokens=${report.totalUsage.totalTokens}`,
    );
    lines.push("");
  }
  lines.push(`> ${report.disclaimer}`);
  lines.push("");

  for (const q of report.questions) {
    lines.push(`## ${q.id} (${q.category})`);
    lines.push("");
    lines.push(`**Question:** ${q.question}`);
    lines.push("");
    lines.push(
      `**Reference sources:** ${q.referenceSources.length ? q.referenceSources.join(", ") : "(none)"}`,
    );
    lines.push("");
    lines.push(
      `Metrics: R@1=${q.metrics.documentRecallAt1}, R@3=${q.metrics.documentRecallAt3}, R@5=${q.metrics.documentRecallAt5}, RR=${q.metrics.reciprocalRank}`,
    );
    lines.push(
      `Timings: embed=${q.timingsMs.questionEmbeddingMs.toFixed(1)}ms, search=${q.timingsMs.localSearchMs.toFixed(1)}ms`,
    );
    if (q.usage?.totalTokens != null) {
      lines.push(`Tokens: total=${q.usage.totalTokens}`);
    }
    lines.push("");
    lines.push("Top hits:");
    lines.push("");
    for (const [i, hit] of q.topHits.entries()) {
      const section = hit.sectionPath?.join(" > ") ?? "-";
      const preview = hit.text.replace(/\s+/g, " ").slice(0, 220);
      lines.push(
        `${i + 1}. \`${hit.chunkId}\` | doc=\`${path.basename(hit.relativePath)}\` | score=${hit.score.toFixed(4)} | section=${section}`,
      );
      lines.push(`   ${preview}${hit.text.length > 220 ? "…" : ""}`);
    }
    lines.push("");
    for (const note of q.reviewNotes) {
      lines.push(`- Note: ${note}`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function fmt(value: number | null): string {
  if (value === null) return "N/A";
  return value.toFixed(3);
}

export async function writeRetrievalEvalReports(
  report: RetrievalEvalReport,
  outDir: string = defaultEvalDir(),
): Promise<{ jsonPath: string; mdPath: string }> {
  await mkdir(outDir, { recursive: true });
  const jsonPath = path.join(outDir, "retrieval-eval.json");
  const mdPath = path.join(outDir, "retrieval-eval.md");
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(mdPath, formatRetrievalEvalMarkdown(report), "utf8");
  return { jsonPath, mdPath };
}
