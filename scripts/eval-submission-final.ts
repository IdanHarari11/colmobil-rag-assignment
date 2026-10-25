/**
 * One-shot submission evaluation on the frozen Hybrid configuration.
 * Does not retune RAG. Writes timestamped reports + a consolidated summary.
 */
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import {
  runAskEval,
  writeAskEvalReports,
} from "../src/eval/run-ask-eval";
import {
  runExtendedAskEval,
  writeExtendedAskEvalReports,
} from "../src/eval/run-extended-ask-eval";
import {
  runConversationEval,
  writeConversationEvalReport,
} from "../src/eval/run-conversation-eval";
import {
  runManualFailDiagnosis,
  writeManualFailDiagnosisReport,
} from "../src/eval/run-manual-fail-diagnosis";
import { runHybridComparison, writeHybridComparisonReports } from "../src/eval/run-hybrid-comparison";
import {
  DEFAULT_CONTEXT_BUDGET_TOKENS,
  getGenerationModel,
  getOpenAiApiKey,
  isAnswerReviewEnabled,
  loadEnv,
  loadValidatedIndex,
  MissingApiKeyError,
  IndexMismatchError,
} from "../src/rag";
import { resolveCodeVersion, resolvePromptBundleId } from "../src/rag/trace/code-version";
import { defaultChunksPath, defaultIndexPath, defaultEvalDir } from "../src/rag/paths";
import { HISTORY_MAX_TOTAL_CHARS, HISTORY_MAX_TURNS } from "../src/rag/history";

const ROOT = process.cwd();
const DEV_SET = path.join(ROOT, "dev_set", "dev_questions.json");
const FREEZE_LABEL = "submission-2026-10-22";

interface RunMeta {
  id: string;
  ok: boolean;
  error?: string;
  retries: number;
  pathJson?: string;
  pathMd?: string;
  durationMs: number;
}

async function withRetry<T>(
  id: string,
  fn: () => Promise<T>,
  maxAttempts = 2,
): Promise<{ result?: T; meta: RunMeta }> {
  const started = performance.now();
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await fn();
      return {
        result,
        meta: {
          id,
          ok: true,
          retries: attempt - 1,
          durationMs: performance.now() - started,
        },
      };
    } catch (error) {
      lastError = error;
      const msg = error instanceof Error ? error.message : String(error);
      const transient =
        /rate limit|timeout|ECONNRESET|503|502|429/i.test(msg) ||
        error instanceof IndexMismatchError;
      console.error(`[${id}] attempt ${attempt} failed: ${msg}`);
      if (!transient || attempt === maxAttempts) break;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  return {
    meta: {
      id,
      ok: false,
      retries: maxAttempts - 1,
      error:
        lastError instanceof Error
          ? lastError.message
          : String(lastError),
      durationMs: performance.now() - started,
    },
  };
}

async function main(): Promise<void> {
  loadEnv(ROOT);
  try {
    getOpenAiApiKey({ required: true });
  } catch (error) {
    if (error instanceof MissingApiKeyError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const index = await loadValidatedIndex({
    chunksPath: defaultChunksPath(),
    indexPath: defaultIndexPath(),
  });
  const generationModel = getGenerationModel();
  const promptBundleId = resolvePromptBundleId();
  const codeVersion = resolveCodeVersion();
  const answerReviewEnabled = isAnswerReviewEnabled();

  console.log(
    [
      `SUBMISSION EVAL ${FREEZE_LABEL}`,
      `model=${generationModel}`,
      `review=${answerReviewEnabled}`,
      `promptBundleId=${promptBundleId}`,
      `code=${codeVersion.value}`,
      `hybrid forced on ask/conversation/manual paths`,
    ].join(" | "),
  );

  if (answerReviewEnabled) {
    console.warn(
      "WARNING: ANSWER_REVIEW_ENABLED is on; submission freeze expects review off.",
    );
  }

  const askOptions = {
    mode: "hybrid" as const,
    topK: 5,
    answerReviewEnabled: false,
    generationModel,
    traceSource: "eval" as const,
  };

  const runs: RunMeta[] = [];
  const outDir = defaultEvalDir();
  await mkdir(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  // 1) Hybrid comparison (retrieval modes labeled)
  {
    const { result, meta } = await withRetry("hybrid-comparison", async () => {
      const report = await runHybridComparison({
        devSetPath: DEV_SET,
        topK: 5,
      });
      const paths = await writeHybridComparisonReports(report);
      // Also keep a stamped submission copy without overwriting historical before/after archives.
      const jsonCopy = path.join(
        outDir,
        `hybrid-comparison-${FREEZE_LABEL}-${stamp}.json`,
      );
      const mdCopy = path.join(
        outDir,
        `hybrid-comparison-${FREEZE_LABEL}-${stamp}.md`,
      );
      await writeFile(jsonCopy, await readFile(paths.jsonPath));
      await writeFile(mdCopy, await readFile(paths.mdPath));
      return { report, jsonCopy, mdCopy };
    });
    meta.pathJson = result?.jsonCopy;
    meta.pathMd = result?.mdCopy;
    runs.push(meta);
    if (result) {
      console.log(
        `hybrid R@5=${result.report.averages.hybrid.documentRecallAt5?.toFixed(3)} ` +
          `MRR=${result.report.averages.hybrid.mrr?.toFixed(3)}`,
      );
    }
  }

  // 2) Dev 15 ask
  let askReportPath: string | undefined;
  {
    const { result, meta } = await withRetry("ask-dev15", async () => {
      const report = await runAskEval({
        devSetPath: DEV_SET,
        askOptions,
        stageLabel: FREEZE_LABEL,
        includeExtraProbes: true,
      });
      const paths = await writeAskEvalReports(
        report,
        outDir,
        `ask-eval-${FREEZE_LABEL}`,
      );
      return { report, ...paths };
    });
    meta.pathJson = result?.jsonPath;
    meta.pathMd = result?.mdPath;
    askReportPath = result?.jsonPath;
    runs.push(meta);
    if (result) {
      console.log(
        `dev15 statusCounts=${JSON.stringify(result.report.statusCounts)} system_errors=${result.report.systemErrorCount}`,
      );
    }
  }

  // 3) Extended 20 (already-exposed set — not a new holdout)
  let extendedPath: string | undefined;
  {
    const { result, meta } = await withRetry("ask-extended20", async () => {
      const report = await runExtendedAskEval({
        stageLabel: `${FREEZE_LABEL}-extended-exposed`,
        askOptions,
      });
      const paths = await writeExtendedAskEvalReports(report);
      const jsonCopy = path.join(
        outDir,
        `ask-eval-extended-${FREEZE_LABEL}-${stamp}.json`,
      );
      const mdCopy = path.join(
        outDir,
        `ask-eval-extended-${FREEZE_LABEL}-${stamp}.md`,
      );
      await writeFile(jsonCopy, await readFile(paths.jsonPath));
      await writeFile(mdCopy, await readFile(paths.mdPath));
      return { report, jsonCopy, mdCopy };
    });
    meta.pathJson = result?.jsonCopy;
    meta.pathMd = result?.mdCopy;
    extendedPath = result?.jsonCopy;
    runs.push(meta);
    if (result) {
      console.log(
        `extended20 statusCounts=${JSON.stringify(result.report.statusCounts)} ` +
          `evidence=${JSON.stringify(result.report.evidenceCoverageCounts)}`,
      );
    }
  }

  // 4) Conversation fixtures
  let convPath: string | undefined;
  {
    const { result, meta } = await withRetry("conversation", async () => {
      const report = await runConversationEval({ askOptions });
      const paths = await writeConversationEvalReport(report);
      const jsonCopy = path.join(
        outDir,
        `conversation-eval-${FREEZE_LABEL}-${stamp}.json`,
      );
      const mdCopy = path.join(
        outDir,
        `conversation-eval-${FREEZE_LABEL}-${stamp}.md`,
      );
      await writeFile(jsonCopy, await readFile(paths.jsonPath));
      await writeFile(mdCopy, await readFile(paths.mdPath));
      return { report, jsonCopy, mdCopy };
    });
    meta.pathJson = result?.jsonCopy;
    meta.pathMd = result?.mdCopy;
    convPath = result?.jsonCopy;
    runs.push(meta);
  }

  // 5) Manual-fail regression (includes multi-scenario + clock cases)
  let manualPath: string | undefined;
  {
    const { result, meta } = await withRetry("manual-fail", async () => {
      const report = await runManualFailDiagnosis({ askOptions });
      report.config.generationModel = generationModel;
      const paths = await writeManualFailDiagnosisReport(report);
      const jsonCopy = path.join(
        outDir,
        `manual-fail-${FREEZE_LABEL}-${stamp}.json`,
      );
      const mdCopy = path.join(
        outDir,
        `manual-fail-${FREEZE_LABEL}-${stamp}.md`,
      );
      await writeFile(jsonCopy, await readFile(paths.jsonPath));
      await writeFile(mdCopy, await readFile(paths.mdPath));
      return { report, jsonCopy, mdCopy };
    });
    meta.pathJson = result?.jsonCopy;
    meta.pathMd = result?.mdCopy;
    manualPath = result?.jsonCopy;
    runs.push(meta);
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    freezeLabel: FREEZE_LABEL,
    note:
      "Final submission evaluation on frozen Hybrid config. Extended set was exposed during development — not a new holdout. Quality dimension labels in the markdown report are AI-assisted where marked.",
    config: {
      promptBundleId,
      codeVersion,
      generationModel,
      embeddingModel: index.manifest.model,
      embeddingDimensions: index.manifest.dimensions,
      answerReviewEnabled: false,
      retrievalMode: "hybrid",
      topK: 5,
      contextBudgetTokens: DEFAULT_CONTEXT_BUDGET_TOKENS,
      historyMaxTurns: HISTORY_MAX_TURNS,
      historyMaxTotalChars: HISTORY_MAX_TOTAL_CHARS,
      chunksInputHash: index.manifest.chunksInputHash,
      embeddingTextHash: index.manifest.embeddingTextHash,
      chunkCount: index.manifest.chunkCount,
      features: [
        "hybrid+retrieval-aliases",
        "document-relations",
        "multi-scenario-keep-versions",
        "computed-temporal-facts",
        "conversational-rewrite",
        "answerParts+citations",
        "answer-review-off",
      ],
    },
    runs,
    artifactPaths: {
      askDev15: askReportPath,
      askExtended20: extendedPath,
      conversation: convPath,
      manualFail: manualPath,
    },
  };

  const summaryJson = path.join(
    outDir,
    `submission-final-${FREEZE_LABEL}-${stamp}.json`,
  );
  await writeFile(summaryJson, JSON.stringify(summary, null, 2), "utf8");
  console.log(`wrote ${path.relative(ROOT, summaryJson)}`);
  console.log(
    `runs ok=${runs.filter((r) => r.ok).length}/${runs.length} ` +
      `api_failures=${runs.filter((r) => !r.ok).map((r) => r.id).join(",") || "none"}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
