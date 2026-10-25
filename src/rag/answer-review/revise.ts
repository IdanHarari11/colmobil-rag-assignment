import OpenAI from "openai";
import type { ChatCompletion } from "openai/resources/chat/completions";
import type { GenerateAnswerResult } from "../generate";
import {
  buildSystemPrompt,
  getGenerationModel,
  parseModelGenerationPayload,
} from "../generate";
import {
  chatCompletionSamplingForModel,
  toChatCompletionRequestFields,
} from "../model-request-params";
import { formatContextForPrompt } from "../context-builder";
import { annotateChunksForPartialUpdates } from "../document-relations/annotate-partial-updates";
import { getOpenAiApiKey, loadEnv } from "../env";
import { formatHistoryForPrompt } from "../history";
import { AnswerReviewSystemError, type ReviseDraftInput } from "./types";

/** Same JSON schema name as generation — revised draft must remain answerParts-shaped. */
const ANSWER_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["status", "answerParts"],
  properties: {
    status: {
      type: "string",
      enum: ["answered", "clarification_needed", "insufficient_evidence"],
    },
    answerParts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "sourceChunkIds"],
        properties: {
          text: { type: "string" },
          sourceChunkIds: {
            type: "array",
            items: { type: "string" },
          },
        },
      },
    },
  },
} as const;

export const REVISE_SYSTEM_EXTRA = [
  "",
  "Limited revision mode: you received review findings about a prior draft.",
  "Fix only according to the findings and the supplied sources. No further retrieval and no facts outside the context.",
  "Allowed: revise the answer, ask for clarification (clarification_needed), or abstain (insufficient_evidence).",
  "Do not invent sources. Use only chunkIds from the allowed list.",
].join("\n");

export function buildReviseUserPrompt(input: ReviseDraftInput): string {
  const allowedIds = input.contextChunks.map((c) => c.chunkId);
  const lines: string[] = [
    `Original question:\n${input.question}`,
    "",
    `Standalone question:\n${input.standaloneQuestion}`,
  ];

  if (input.history.length > 0) {
    lines.push(
      "",
      "History (references only — not insurance facts):",
      formatHistoryForPrompt(input.history),
    );
  }

  if (input.unresolvedReferences.length > 0) {
    lines.push(
      "",
      "unresolvedReferences:",
      ...input.unresolvedReferences.map((u) => `- ${u}`),
    );
  }

  if (input.applicabilitySummary?.promptLines.length) {
    lines.push("", ...input.applicabilitySummary.promptLines);
  }

  lines.push(
    "",
    "Prior draft:",
    JSON.stringify(
      { status: input.draft.status, answerParts: input.draft.answerParts },
      null,
      2,
    ),
    "",
    "Review findings to fix:",
    JSON.stringify(
      input.findings.map((f) => ({
        problemType: f.problemType,
        affectedPartIndex: f.affectedPartIndex,
        sourceChunkIds: f.sourceChunkIds,
        severity: f.severity,
        requiredFix: f.requiredFix,
        explanation: f.explanation,
      })),
      null,
      2,
    ),
    "",
    `Allowed chunkIds: ${allowedIds.join(", ") || "(none)"}`,
    "",
    "Context (same sources — no new sources):",
    formatContextForPrompt(
      annotateChunksForPartialUpdates(
        input.contextChunks,
        input.applicabilitySummary,
      ),
    ),
  );

  return lines.join("\n");
}

/**
 * One-shot revision using the same context as the draft. No new retrieval.
 */
export async function reviseAnswerDraft(
  input: ReviseDraftInput,
  options: {
    model?: string;
    apiKey?: string;
    signal?: AbortSignal;
  } = {},
): Promise<GenerateAnswerResult> {
  loadEnv();
  const model = options.model ?? getGenerationModel();
  const apiKey = options.apiKey ?? getOpenAiApiKey({ required: true });
  const client = new OpenAI({ apiKey });
  const allowedIds = input.contextChunks.map((c) => c.chunkId);
  const samplingProfile = chatCompletionSamplingForModel(model);

  if (options.signal?.aborted) {
    throw new DOMException("Request aborted", "AbortError");
  }
  const started = performance.now();
  let response: ChatCompletion;
  try {
    response = (await client.chat.completions.create(
      {
        model,
        ...toChatCompletionRequestFields(samplingProfile),
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "grounded_answer_parts_revision",
            strict: true,
            schema: ANSWER_JSON_SCHEMA,
          },
        },
        messages: [
          {
            role: "system",
            content: buildSystemPrompt(allowedIds) + REVISE_SYSTEM_EXTRA,
          },
          { role: "user", content: buildReviseUserPrompt(input) },
        ],
      } as Parameters<typeof client.chat.completions.create>[0],
      options.signal ? { signal: options.signal } : undefined,
    )) as ChatCompletion;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new AnswerReviewSystemError(`Revision API error: ${message}`);
  }

  const latencyMs = performance.now() - started;
  const rawText = response.choices[0]?.message?.content ?? "";
  if (!rawText.trim()) {
    throw new AnswerReviewSystemError("Revision API returned empty content.");
  }

  // Reuse generation parser; wrap structural failures as review system errors.
  let payload;
  try {
    payload = parseModelGenerationPayload(rawText);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new AnswerReviewSystemError(`Revision payload invalid: ${message}`);
  }

  return {
    payload,
    rawText,
    modelRequested: model,
    modelReturned: response.model?.trim() || model,
    model: response.model?.trim() || model,
    samplingProfile,
    latencyMs,
    usage: {
      promptTokens: response.usage?.prompt_tokens,
      completionTokens: response.usage?.completion_tokens,
      totalTokens: response.usage?.total_tokens,
      cachedInputTokens: response.usage?.prompt_tokens_details?.cached_tokens,
    },
  };
}
