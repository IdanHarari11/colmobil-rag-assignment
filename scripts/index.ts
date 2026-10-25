import path from "node:path";
import {
  MissingApiKeyError,
  buildLocalIndex,
  getOpenAiApiKey,
  loadEnv,
} from "../src/rag";

const ROOT = process.cwd();

async function main(): Promise<void> {
  loadEnv(ROOT);
  const force = process.argv.includes("--force");

  try {
    getOpenAiApiKey({ required: true });
  } catch (error) {
    if (error instanceof MissingApiKeyError) {
      console.error(error.message);
      console.error(
        "Index build requires a real OpenAI API key. Local unit tests do not use the API.",
      );
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const result = await buildLocalIndex({ force });
  const relative = path.relative(ROOT, result.indexPath);

  if (result.reused) {
    console.log(`Reused existing index (${result.index.manifest.chunkCount} vectors) → ${relative}`);
  } else {
    console.log(
      `Built index: embedded ${result.embeddedCount}/${result.index.manifest.chunkCount} chunks → ${relative}`,
    );
  }

  const m = result.index.manifest;
  console.log(
    `model=${m.model} dims=${m.dimensions} formatVersion=${m.formatVersion}`,
  );
  console.log(
    `chunksInputHash=${m.chunksInputHash.slice(0, 12)}… embeddingTextHash=${m.embeddingTextHash.slice(0, 12)}…`,
  );
  if (m.usage) {
    console.log(
      `API usage: prompt_tokens=${m.usage.promptTokens} total_tokens=${m.usage.totalTokens}`,
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
