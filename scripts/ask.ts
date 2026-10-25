import {
  ask,
  GenerationSystemError,
  IndexMismatchError,
  MissingApiKeyError,
  getOpenAiApiKey,
  loadEnv,
  type RetrieveMode,
} from "../src/rag";

const ROOT = process.cwd();

function parseArgs(argv: string[]): {
  question: string;
  topK: number;
  mode: RetrieveMode;
} {
  const rest = [...argv];
  let topK = 5;
  let mode: RetrieveMode = "hybrid";

  const takeFlag = (names: string[]): string | undefined => {
    const idx = rest.findIndex((arg) => names.includes(arg));
    if (idx < 0) return undefined;
    const value = rest[idx + 1];
    if (!value || value.startsWith("-")) {
      throw new Error(`Missing value for ${rest[idx]}`);
    }
    rest.splice(idx, 2);
    return value;
  };

  const topKRaw = takeFlag(["--topK", "--topk"]);
  if (topKRaw) topK = Number.parseInt(topKRaw, 10);

  const modeRaw = takeFlag(["--mode"]);
  if (modeRaw) {
    if (modeRaw !== "vector" && modeRaw !== "lexical" && modeRaw !== "hybrid") {
      throw new Error(`Invalid --mode ${modeRaw} (use vector|lexical|hybrid)`);
    }
    mode = modeRaw;
  }

  const question = rest
    .filter((arg) => arg !== "--")
    .join(" ")
    .trim();
  if (!question) {
    throw new Error('Usage: pnpm ask -- "question" [--mode hybrid] [--topK 5]');
  }
  return { question, topK, mode };
}

async function main(): Promise<void> {
  loadEnv(ROOT);
  const { question, topK, mode } = parseArgs(process.argv.slice(2));

  try {
    getOpenAiApiKey({ required: true });
  } catch (error) {
    if (error instanceof MissingApiKeyError) {
      console.error(error.message);
      console.error("ask() requires OPENAI_API_KEY for embeddings + generation.");
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const result = await ask(question, { topK, mode, traceSource: "cli" });

  console.log(`requestId=${result.requestId}`);
  console.log(`status=${result.status}`);
  console.log(
    `mode=${result.retrievalMode} generation=${result.generationModel} embedding=${result.embeddingModel}`,
  );
  if (result.rewrite) {
    console.log(`originalQuestion=${result.rewrite.originalQuestion}`);
    console.log(`standaloneQuestion=${result.rewrite.standaloneQuestion}`);
    console.log(
      `unresolvedReferences=${result.rewrite.unresolvedReferences.join(" | ") || "(none)"}`,
    );
  } else {
    console.log(`standaloneQuestion=${result.standaloneQuestion}`);
  }
  console.log(
    `timings: ` +
      (result.timingsMs.rewriteMs !== undefined
        ? `rewrite=${result.timingsMs.rewriteMs.toFixed(0)}ms `
        : "") +
      `retrieve=${result.timingsMs.retrieveMs.toFixed(0)}ms ` +
      `context=${result.timingsMs.contextMs.toFixed(0)}ms ` +
      `gen=${result.timingsMs.generationMs.toFixed(0)}ms ` +
      `total=${result.timingsMs.totalMs.toFixed(0)}ms`,
  );
  if (result.usage) {
    console.log(
      `tokens: embed_prompt=${result.usage.embeddingPromptTokens ?? "-"} ` +
        `rewrite_prompt=${result.usage.rewritePromptTokens ?? "-"} ` +
        `rewrite_completion=${result.usage.rewriteCompletionTokens ?? "-"} ` +
        `gen_prompt=${result.usage.generationPromptTokens ?? "-"} ` +
        `gen_completion=${result.usage.generationCompletionTokens ?? "-"} ` +
        `gen_total=${result.usage.generationTotalTokens ?? "-"}`,
    );
  }
  console.log(
    `context: estimated=${result.contextMeta.estimatedContextTokens}/` +
      `${result.contextMeta.budgetTokens} complete=${result.contextMeta.contextComplete}`,
  );
  console.log(
    `validation: structure=${result.validation.structureOk} citations=${result.validation.citationsOk}`,
  );
  console.log("");
  console.log(result.answer);
  console.log("");
  console.log("Sources used:");
  if (result.sources.length === 0) {
    console.log("  (none)");
  } else {
    for (const source of result.sources) {
      console.log(
        `  - ${source.chunkId} (${source.fileName}` +
          `${source.pages?.length ? `, p.${source.pages.join(",")}` : ""}) ` +
          `[${source.origin}]`,
      );
      for (const claim of source.claims) {
        console.log(`      claim: ${claim}`);
      }
    }
  }
  console.log("");
  console.log(
    `retrieved=${result.retrievedChunks.length} contextChunks=${result.contextChunks.length} ` +
      `(expanded=${result.contextChunks.filter((c) => c.origin === "expanded").length})`,
  );
}

main().catch((error) => {
  if (
    error instanceof IndexMismatchError ||
    error instanceof MissingApiKeyError ||
    error instanceof GenerationSystemError
  ) {
    console.error(`[system] ${error.message}`);
  } else {
    console.error(error instanceof Error ? error.message : error);
  }
  process.exitCode = 1;
});
