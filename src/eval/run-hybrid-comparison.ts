import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createOpenAiEmbedder } from "../rag/embedder";
import { defaultEvalDir } from "../rag/paths";
import {
  HYBRID_EXPERIMENT_CONFIG,
  retrieve,
  type RetrieveDependencies,
} from "../rag/retrieve";
import { BM25_TOKENIZER_NOTES } from "../rag/tokenize";
import type { LocalIndex, RetrieveMode, RetrievalHit } from "../rag/types";
import { loadValidatedIndex } from "../rag/index-store";
import { defaultChunksPath, defaultIndexPath } from "../rag/paths";
import {
  documentRecallAtK,
  mean,
  reciprocalRank,
} from "./retrieval-metrics";
import {
  loadDevQuestions,
  type DevQuestion,
} from "./run-retrieval-eval";

export type ComparisonDelta = "improved" | "regressed" | "unchanged";

export interface ModeHitSnapshot {
  chunkId: string;
  documentId: string;
  relativePath: string;
  sectionPath?: string[];
  score: number;
  semanticScore?: number;
  lexicalScore?: number;
  fusionScore?: number;
  semanticRank?: number;
  lexicalRank?: number;
  textPreview: string;
}

export interface ModeResultSnapshot {
  mode: RetrieveMode;
  metrics: {
    documentRecallAt1: number | "N/A";
    documentRecallAt3: number | "N/A";
    documentRecallAt5: number | "N/A";
    reciprocalRank: number | "N/A";
  };
  localSearchMs: number;
  lexicalFallbackToSemantic?: boolean;
  topHits: ModeHitSnapshot[];
  vsVectorR5?: ComparisonDelta;
  vsVectorRR?: ComparisonDelta;
}

export interface HybridComparisonQuestion {
  id: string;
  category: string;
  question: string;
  referenceSources: string[];
  questionEmbeddingMs: number;
  modes: Record<RetrieveMode, ModeResultSnapshot>;
}

export interface HybridComparisonReport {
  generatedAt: string;
  experimentId: string;
  index: {
    path: string;
    model: string;
    dimensions: number;
    chunkCount: number;
    chunksInputHash: string;
    embeddingTextHash: string;
  };
  config: {
    topK: number;
    bm25: typeof HYBRID_EXPERIMENT_CONFIG.bm25;
    rrfC: number;
    tokenizerNotes: readonly string[];
    hybridNotes: readonly string[];
  };
  totals: {
    questionCount: number;
    scoredQuestionCount: number;
    noReferenceQuestionIds: string[];
    promptTokens: number;
    totalTokens: number;
    avgQuestionEmbeddingMs: number;
  };
  averages: Record<
    RetrieveMode,
    {
      documentRecallAt1: number | null;
      documentRecallAt3: number | null;
      documentRecallAt5: number | null;
      mrr: number | null;
      avgLocalSearchMs: number;
    }
  >;
  deltasVsVector: {
    recallAt5: Record<"improved" | "regressed" | "unchanged", number>;
    reciprocalRank: Record<"improved" | "regressed" | "unchanged", number>;
  };
  questions: HybridComparisonQuestion[];
  disclaimer: string;
}

function metricOrNA(value: number | null): number | "N/A" {
  return value === null ? "N/A" : value;
}

function snapshotHits(hits: RetrievalHit[]): ModeHitSnapshot[] {
  return hits.map((hit) => ({
    chunkId: hit.chunkId,
    documentId: hit.documentId,
    relativePath: hit.relativePath,
    sectionPath: hit.sectionPath,
    score: hit.score,
    semanticScore: hit.semanticScore,
    lexicalScore: hit.lexicalScore,
    fusionScore: hit.fusionScore,
    semanticRank: hit.semanticRank,
    lexicalRank: hit.lexicalRank,
    textPreview: hit.text.replace(/\s+/g, " ").slice(0, 240),
  }));
}

function compareMetric(
  hybridOrLex: number | "N/A",
  vector: number | "N/A",
): ComparisonDelta | undefined {
  if (hybridOrLex === "N/A" || vector === "N/A") return undefined;
  if (hybridOrLex > vector) return "improved";
  if (hybridOrLex < vector) return "regressed";
  return "unchanged";
}

function modeMetrics(hits: RetrievalHit[], sources: string[], topK: number) {
  return {
    documentRecallAt1: metricOrNA(documentRecallAtK(hits, sources, 1)),
    documentRecallAt3: metricOrNA(documentRecallAtK(hits, sources, 3)),
    documentRecallAt5: metricOrNA(documentRecallAtK(hits, sources, topK)),
    reciprocalRank: metricOrNA(reciprocalRank(hits, sources)),
  };
}

function avgForMode(
  questions: HybridComparisonQuestion[],
  mode: RetrieveMode,
) {
  const scored = questions.filter((q) => q.referenceSources.length > 0);
  return {
    documentRecallAt1: mean(
      scored.map((q) => q.modes[mode].metrics.documentRecallAt1 as number),
    ),
    documentRecallAt3: mean(
      scored.map((q) => q.modes[mode].metrics.documentRecallAt3 as number),
    ),
    documentRecallAt5: mean(
      scored.map((q) => q.modes[mode].metrics.documentRecallAt5 as number),
    ),
    mrr: mean(scored.map((q) => q.modes[mode].metrics.reciprocalRank as number)),
    avgLocalSearchMs:
      questions.reduce((sum, q) => sum + q.modes[mode].localSearchMs, 0) /
      (questions.length || 1),
  };
}

function countDeltas(
  questions: HybridComparisonQuestion[],
  mode: "lexical" | "hybrid",
  field: "vsVectorR5" | "vsVectorRR",
): Record<"improved" | "regressed" | "unchanged", number> {
  const counts = { improved: 0, regressed: 0, unchanged: 0 };
  for (const q of questions) {
    if (q.referenceSources.length === 0) continue;
    const delta = q.modes[mode][field];
    if (delta) counts[delta] += 1;
  }
  return counts;
}

export async function runHybridComparison(options: {
  devSetPath: string;
  topK?: number;
  index?: LocalIndex;
  deps?: RetrieveDependencies;
}): Promise<HybridComparisonReport> {
  const topK = options.topK ?? 5;
  const questions = await loadDevQuestions(options.devSetPath);
  const index =
    options.index ??
    (await loadValidatedIndex({
      chunksPath: defaultChunksPath(),
      indexPath: defaultIndexPath(),
    }));

  const embedder =
    options.deps?.embedder ??
    createOpenAiEmbedder({
      config: {
        model: index.manifest.model,
        dimensions: index.manifest.dimensions,
      },
    });

  const deps: RetrieveDependencies = {
    ...options.deps,
    index,
    embedder,
  };

  const results: HybridComparisonQuestion[] = [];
  let promptTokens = 0;
  let totalTokens = 0;
  let embedMsTotal = 0;

  for (const question of questions) {
    // One embedding per question for fair vector + hybrid comparison.
    const embedStarted = performance.now();
    const embedded = await embedder.embedTexts([question.question]);
    const questionEmbeddingMs = performance.now() - embedStarted;
    embedMsTotal += questionEmbeddingMs;
    promptTokens += embedded.usage.promptTokens;
    totalTokens += embedded.usage.totalTokens;
    const queryEmbedding = embedded.embeddings[0]!;

    const vector = await retrieve(
      question.question,
      { topK, mode: "vector", queryEmbedding },
      deps,
    );
    const lexical = await retrieve(
      question.question,
      { topK, mode: "lexical" },
      deps,
    );
    const hybrid = await retrieve(
      question.question,
      { topK, mode: "hybrid", queryEmbedding },
      deps,
    );

    const vectorSnap: ModeResultSnapshot = {
      mode: "vector",
      metrics: modeMetrics(vector.hits, question.sources, topK),
      localSearchMs: vector.timingsMs.localSearchMs,
      topHits: snapshotHits(vector.hits),
    };
    const lexicalSnap: ModeResultSnapshot = {
      mode: "lexical",
      metrics: modeMetrics(lexical.hits, question.sources, topK),
      localSearchMs: lexical.timingsMs.localSearchMs,
      topHits: snapshotHits(lexical.hits),
      vsVectorR5: compareMetric(
        modeMetrics(lexical.hits, question.sources, topK).documentRecallAt5,
        vectorSnap.metrics.documentRecallAt5,
      ),
      vsVectorRR: compareMetric(
        modeMetrics(lexical.hits, question.sources, topK).reciprocalRank,
        vectorSnap.metrics.reciprocalRank,
      ),
    };
    const hybridSnap: ModeResultSnapshot = {
      mode: "hybrid",
      metrics: modeMetrics(hybrid.hits, question.sources, topK),
      localSearchMs: hybrid.timingsMs.localSearchMs,
      lexicalFallbackToSemantic: hybrid.lexicalFallbackToSemantic,
      topHits: snapshotHits(hybrid.hits),
      vsVectorR5: compareMetric(
        modeMetrics(hybrid.hits, question.sources, topK).documentRecallAt5,
        vectorSnap.metrics.documentRecallAt5,
      ),
      vsVectorRR: compareMetric(
        modeMetrics(hybrid.hits, question.sources, topK).reciprocalRank,
        vectorSnap.metrics.reciprocalRank,
      ),
    };

    results.push({
      id: question.id,
      category: question.category,
      question: question.question,
      referenceSources: question.sources,
      questionEmbeddingMs,
      modes: {
        vector: vectorSnap,
        lexical: lexicalSnap,
        hybrid: hybridSnap,
      },
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    experimentId: "hybrid-bm25-rrf-v1",
    index: {
      path: "data/index/embeddings.json",
      model: index.manifest.model,
      dimensions: index.manifest.dimensions,
      chunkCount: index.manifest.chunkCount,
      chunksInputHash: index.manifest.chunksInputHash,
      embeddingTextHash: index.manifest.embeddingTextHash,
    },
    config: {
      topK,
      bm25: HYBRID_EXPERIMENT_CONFIG.bm25,
      rrfC: HYBRID_EXPERIMENT_CONFIG.rrfC,
      tokenizerNotes: BM25_TOKENIZER_NOTES,
      hybridNotes: HYBRID_EXPERIMENT_CONFIG.notes,
    },
    totals: {
      questionCount: results.length,
      scoredQuestionCount: results.filter((q) => q.referenceSources.length > 0)
        .length,
      noReferenceQuestionIds: results
        .filter((q) => q.referenceSources.length === 0)
        .map((q) => q.id),
      promptTokens,
      totalTokens,
      avgQuestionEmbeddingMs: embedMsTotal / (results.length || 1),
    },
    averages: {
      vector: avgForMode(results, "vector"),
      lexical: avgForMode(results, "lexical"),
      hybrid: avgForMode(results, "hybrid"),
    },
    deltasVsVector: {
      recallAt5: countDeltas(results, "hybrid", "vsVectorR5"),
      reciprocalRank: countDeltas(results, "hybrid", "vsVectorRR"),
    },
    questions: results,
    disclaimer:
      "Dev-set comparison only — not proof of performance on unseen questions. Document Recall ≠ answer-span sufficiency. Scores are not confidence. D05 remains ambiguous regardless of retrieval mode.",
  };
}

export function formatHybridComparisonMarkdown(
  report: HybridComparisonReport,
): string {
  const lines: string[] = [];
  lines.push("# Hybrid comparison report (vector vs BM25 vs RRF)");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Experiment: ${report.experimentId}`);
  lines.push(
    `Index: ${report.index.model} dims=${report.index.dimensions} chunks=${report.index.chunkCount} hash=${report.index.chunksInputHash.slice(0, 12)}…`,
  );
  lines.push(
    `Config: BM25 k1=${report.config.bm25.k1} b=${report.config.bm25.b}; RRF c=${report.config.rrfC}; topK=${report.config.topK}`,
  );
  lines.push("");
  lines.push("## Averages (scored questions only)");
  lines.push("");
  lines.push("| Mode | R@1 | R@3 | R@5 | MRR | avg local search ms |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const mode of ["vector", "lexical", "hybrid"] as RetrieveMode[]) {
    const a = report.averages[mode];
    lines.push(
      `| ${mode} | ${fmt(a.documentRecallAt1)} | ${fmt(a.documentRecallAt3)} | ${fmt(a.documentRecallAt5)} | ${fmt(a.mrr)} | ${a.avgLocalSearchMs.toFixed(2)} |`,
    );
  }
  lines.push("");
  lines.push(
    `Hybrid vs vector (R@5 counts): improved=${report.deltasVsVector.recallAt5.improved}, regressed=${report.deltasVsVector.recallAt5.regressed}, unchanged=${report.deltasVsVector.recallAt5.unchanged}`,
  );
  lines.push(
    `API tokens (one embed/question): prompt=${report.totals.promptTokens} total=${report.totals.totalTokens}; avg embed=${report.totals.avgQuestionEmbeddingMs.toFixed(1)}ms`,
  );
  lines.push("");
  lines.push(`> ${report.disclaimer}`);
  lines.push("");

  for (const q of report.questions) {
    lines.push(`## ${q.id} (${q.category})`);
    lines.push("");
    lines.push(`**Question:** ${q.question}`);
    lines.push(
      `**Refs:** ${q.referenceSources.length ? q.referenceSources.join(", ") : "(none)"}`,
    );
    lines.push(`**Embed ms:** ${q.questionEmbeddingMs.toFixed(1)}`);
    lines.push("");
    lines.push("| Mode | R@5 | RR | vs vector R@5 | vs vector RR |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const mode of ["vector", "lexical", "hybrid"] as RetrieveMode[]) {
      const m = q.modes[mode];
      lines.push(
        `| ${mode} | ${m.metrics.documentRecallAt5} | ${m.metrics.reciprocalRank} | ${m.vsVectorR5 ?? "-"} | ${m.vsVectorRR ?? "-"} |`,
      );
    }
    lines.push("");
    for (const mode of ["vector", "lexical", "hybrid"] as RetrieveMode[]) {
      lines.push(`### ${mode} top5`);
      for (const [i, hit] of q.modes[mode].topHits.entries()) {
        lines.push(
          `${i + 1}. \`${hit.chunkId}\` score=${hit.score.toFixed(4)} semR=${hit.semanticRank ?? "-"} lexR=${hit.lexicalRank ?? "-"} | ${path.basename(hit.relativePath)}`,
        );
        lines.push(`   ${hit.textPreview}`);
      }
      lines.push("");
    }
  }

  return `${lines.join("\n")}\n`;
}

function fmt(value: number | null): string {
  if (value === null) return "N/A";
  return value.toFixed(3);
}

export async function writeHybridComparisonReports(
  report: HybridComparisonReport,
  outDir: string = defaultEvalDir(),
): Promise<{ jsonPath: string; mdPath: string }> {
  await mkdir(outDir, { recursive: true });
  const jsonPath = path.join(outDir, "hybrid-comparison.json");
  const mdPath = path.join(outDir, "hybrid-comparison.md");
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(mdPath, formatHybridComparisonMarkdown(report), "utf8");
  return { jsonPath, mdPath };
}

/** Re-export for scripts that only need the question type. */
export type { DevQuestion };
