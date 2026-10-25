import { config as loadDotenv } from "dotenv";
import path from "node:path";
import {
  DEFAULT_EMBEDDING_DIMENSIONS,
  DEFAULT_EMBEDDING_MODEL,
  type EmbeddingConfig,
  MissingApiKeyError,
} from "./types";

let envLoaded = false;

/** Load documented env files for CLI scripts (not for Next browser bundles). */
export function loadEnv(rootDir: string = process.cwd()): void {
  if (envLoaded) return;
  // Later files do not override already-set process.env values by default.
  loadDotenv({ path: path.join(rootDir, ".env") });
  loadDotenv({ path: path.join(rootDir, ".env.local") });
  envLoaded = true;
}

export function getOpenAiApiKey(options?: { required?: boolean }): string | undefined {
  loadEnv();
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key && options?.required) {
    throw new MissingApiKeyError();
  }
  return key || undefined;
}

export function getEmbeddingConfig(): EmbeddingConfig {
  loadEnv();
  const model =
    process.env.OPENAI_EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL;
  const dimensionsRaw = process.env.OPENAI_EMBEDDING_DIMENSIONS?.trim();
  const dimensions = dimensionsRaw
    ? Number.parseInt(dimensionsRaw, 10)
    : DEFAULT_EMBEDDING_DIMENSIONS;
  if (!Number.isFinite(dimensions) || dimensions <= 0) {
    throw new Error(
      `Invalid OPENAI_EMBEDDING_DIMENSIONS: ${dimensionsRaw ?? "(empty)"}`,
    );
  }
  return { model, dimensions };
}
