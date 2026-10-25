import {
  IndexMismatchError,
  MissingApiKeyError,
  getOpenAiApiKey,
  loadEnv,
  retrieve,
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
  let mode: RetrieveMode = "vector";

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
    throw new Error(
      'Usage: pnpm retrieve -- "question" [--mode vector|lexical|hybrid] [--topK 5]',
    );
  }
  return { question, topK, mode };
}

async function main(): Promise<void> {
  loadEnv(ROOT);
  const { question, topK, mode } = parseArgs(process.argv.slice(2));

  if (mode !== "lexical") {
    try {
      getOpenAiApiKey({ required: true });
    } catch (error) {
      if (error instanceof MissingApiKeyError) {
        console.error(error.message);
        console.error("vector/hybrid retrieval requires OPENAI_API_KEY.");
        process.exitCode = 1;
        return;
      }
      throw error;
    }
  }

  const result = await retrieve(question, { topK, mode });

  console.log(`Question: ${result.question}`);
  console.log(
    `mode=${result.mode} model=${result.model} dims=${result.dimensions} topK=${result.topK}`,
  );
  if (result.lexicalFallbackToSemantic) {
    console.log("note: hybrid fell back to semantic (no positive BM25 hits)");
  }
  console.log(
    `timings: embed=${result.timingsMs.questionEmbeddingMs.toFixed(1)}ms search=${result.timingsMs.localSearchMs.toFixed(1)}ms`,
  );
  if (result.usage?.totalTokens != null) {
    console.log(
      `tokens: prompt=${result.usage.promptTokens ?? "?"} total=${result.usage.totalTokens}`,
    );
  }
  console.log("");

  for (const [i, hit] of result.hits.entries()) {
    const section = hit.sectionPath?.join(" > ") ?? "-";
    console.log(`${i + 1}. score=${hit.score.toFixed(4)} ${hit.chunkId}`);
    console.log(
      `   sem=${hit.semanticScore?.toFixed(4) ?? "-"}@${hit.semanticRank ?? "-"} ` +
        `lex=${hit.lexicalScore?.toFixed(4) ?? "-"}@${hit.lexicalRank ?? "-"} ` +
        `fusion=${hit.fusionScore?.toFixed(4) ?? "-"}`,
    );
    console.log(`   doc=${hit.relativePath} | section=${section}`);
    console.log(`   ${hit.text.replace(/\s+/g, " ").slice(0, 240)}…`);
    console.log("");
  }
}

main().catch((error) => {
  if (error instanceof IndexMismatchError || error instanceof MissingApiKeyError) {
    console.error(error.message);
  } else {
    console.error(error instanceof Error ? error.message : error);
  }
  process.exitCode = 1;
});
