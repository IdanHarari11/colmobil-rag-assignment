import OpenAI from "openai";
import { getEmbeddingConfig, getOpenAiApiKey } from "./env";
import type { EmbeddingConfig } from "./types";
import { MissingApiKeyError } from "./types";

export interface EmbedBatchResult {
  embeddings: number[][];
  usage: {
    promptTokens: number;
    totalTokens: number;
  };
  config: EmbeddingConfig;
}

export interface Embedder {
  config: EmbeddingConfig;
  embedTexts(texts: string[]): Promise<EmbedBatchResult>;
}

const MAX_BATCH = 64;

export function createOpenAiEmbedder(options?: {
  apiKey?: string;
  config?: EmbeddingConfig;
}): Embedder {
  const config = options?.config ?? getEmbeddingConfig();
  const apiKey = options?.apiKey ?? getOpenAiApiKey({ required: true });
  if (!apiKey) {
    throw new MissingApiKeyError();
  }

  const client = new OpenAI({ apiKey });

  return {
    config,
    async embedTexts(texts: string[]): Promise<EmbedBatchResult> {
      if (texts.length === 0) {
        return {
          embeddings: [],
          usage: { promptTokens: 0, totalTokens: 0 },
          config,
        };
      }

      const embeddings: number[][] = new Array(texts.length);
      let promptTokens = 0;
      let totalTokens = 0;

      for (let start = 0; start < texts.length; start += MAX_BATCH) {
        const batch = texts.slice(start, start + MAX_BATCH);
        const response = await client.embeddings.create({
          model: config.model,
          input: batch,
          dimensions: config.dimensions,
        });

        promptTokens += response.usage?.prompt_tokens ?? 0;
        totalTokens += response.usage?.total_tokens ?? 0;

        for (const item of response.data) {
          const vector = item.embedding;
          if (vector.length !== config.dimensions) {
            throw new Error(
              `Embedding dimension mismatch: expected ${config.dimensions}, got ${vector.length}`,
            );
          }
          embeddings[start + item.index] = vector;
        }
      }

      for (let i = 0; i < embeddings.length; i++) {
        if (!embeddings[i]) {
          throw new Error(`Missing embedding for input index ${i}`);
        }
      }

      return {
        embeddings,
        usage: { promptTokens, totalTokens },
        config,
      };
    },
  };
}
