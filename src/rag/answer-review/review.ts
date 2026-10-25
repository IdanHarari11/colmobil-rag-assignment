import OpenAI from "openai";
import type { ChatCompletion } from "openai/resources/chat/completions";
import { formatContextForPrompt } from "../context-builder";
import { annotateChunksForPartialUpdates } from "../document-relations/annotate-partial-updates";
import { getOpenAiApiKey, loadEnv } from "../env";
import { getGenerationModel } from "../generate";
import {
  chatCompletionSamplingForModel,
  toChatCompletionRequestFields,
} from "../model-request-params";
import { formatHistoryForPrompt } from "../history";
import { AnswerReviewSystemError, type ReviewCallResult, type ReviewDraftInput } from "./types";
import { parseReviewResultPayload } from "./validate-review";

export const REVIEW_SYSTEM_PROMPT = [
  "You are a draft checker for a Hebrew insurance RAG assistant (fictional company Ofek).",
  "You do NOT invent insurance facts. You only judge whether the draft is supported by the supplied context chunks.",
  "This check is fallible — report structured findings only; do not claim absolute ground truth.",
  "",
  "Inputs include: original question, rewritten question, optional history (for reference resolution only),",
  "unresolvedReferences, proposed status+answerParts, contextChunks for THIS turn, and applicability metadata with evidence ids.",
  "",
  "Critical rules:",
  "- History text and the draft are NOT sources of insurance facts.",
  "- An assistant claim in prior turns is NOT a user-confirmed fact.",
  "- Do not assume a product (e.g. auto) only because retrieval returned auto documents.",
  "- Do not require copying every condition/exception from a document.",
  "- Omitting a detail that does not change the answer is NOT a blocking issue (secondary at most, or ignore).",
  "- Wording differences alone are not failures.",
  "- Ask for clarification only when a missing detail materially changes the answer; if the question can already be answered or a relevant condition can be stated explicitly, do not demand extra user details.",
  "- Prefer pass when claims are supported and status is appropriate.",
  "- If status=insufficient_evidence with empty answerParts: that is a valid abstention",
  "  when context lacks the asked topic. Do NOT invent unsupported_claim findings on an empty abstention.",
  "  Only flag inappropriate_response_status if abstention is clearly wrong given rich supporting context.",
  "- If status=clarification_needed: pass when a material detail is missing; revise only if clarification is unnecessary.",
  "",
  "Check for:",
  "1) Cited sources actually support the associated claims.",
  "2) Added amounts, coverage, exceptions, or facts not supported by context.",
  "3) Omitted material conditions that change eligibility, amount, timing, or required action.",
  "4) Consistency with document applicability / version decisions (when provided).",
  "5) Unjustified product or fact assumptions.",
  "6) Whether clarification_needed or insufficient_evidence is actually warranted.",
  "",
  "Output JSON only: decision (pass|revise) and findings[].",
  "Each finding: problemType, affectedPartIndex (null if overall), sourceChunkIds (from allowed list only),",
  "explanation (short), requiredFix (short), severity (material|secondary).",
  "Use revise only for material problems. Secondary issues alone → decision=pass.",
  "problemType enum: unsupported_claim | incorrect_citation | contradiction | missing_material_condition |",
  "wrong_applicability | unjustified_assumption | inappropriate_response_status.",
].join("\n");

const REVIEW_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["decision", "findings"],
  properties: {
    decision: { type: "string", enum: ["pass", "revise"] },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "problemType",
          "affectedPartIndex",
          "sourceChunkIds",
          "explanation",
          "requiredFix",
          "severity",
        ],
        properties: {
          problemType: {
            type: "string",
            enum: [
              "unsupported_claim",
              "incorrect_citation",
              "contradiction",
              "missing_material_condition",
              "wrong_applicability",
              "unjustified_assumption",
              "inappropriate_response_status",
            ],
          },
          affectedPartIndex: {
            anyOf: [{ type: "integer" }, { type: "null" }],
          },
          sourceChunkIds: { type: "array", items: { type: "string" } },
          explanation: { type: "string" },
          requiredFix: { type: "string" },
          severity: { type: "string", enum: ["material", "secondary"] },
        },
      },
    },
  },
} as const;

export function buildReviewUserPrompt(input: ReviewDraftInput): string {
  const allowedIds = input.contextChunks.map((c) => c.chunkId);
  const lines: string[] = [
    `Original question:\n${input.question}`,
    "",
    `Standalone question (rewrite/retrieval):\n${input.standaloneQuestion}`,
  ];

  if (input.history.length > 0) {
    lines.push(
      "",
      "Limited history (reference resolution only — not a source of insurance facts;",
      "a detail the assistant assumed is not a user-confirmed detail):",
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
    "Proposed answer draft (JSON):",
    JSON.stringify(
      {
        status: input.draft.status,
        answerParts: input.draft.answerParts,
      },
      null,
      2,
    ),
    "",
    `Allowed chunkIds in findings: ${allowedIds.join(", ") || "(none)"}`,
    "",
    "Context (this turn's sources only):",
    formatContextForPrompt(
      annotateChunksForPartialUpdates(
        input.contextChunks,
        input.applicabilitySummary,
      ),
    ),
  );

  return lines.join("\n");
}

export async function reviewAnswerDraft(
  input: ReviewDraftInput,
  options: {
    model?: string;
    apiKey?: string;
    signal?: AbortSignal;
  } = {},
): Promise<ReviewCallResult> {
  loadEnv();
  const model = options.model ?? getGenerationModel();
  const apiKey = options.apiKey ?? getOpenAiApiKey({ required: true });
  const client = new OpenAI({ apiKey });
  const samplingFields = toChatCompletionRequestFields(
    chatCompletionSamplingForModel(model),
  );

  if (options.signal?.aborted) {
    throw new DOMException("Request aborted", "AbortError");
  }

  const started = performance.now();
  let response: ChatCompletion;
  try {
    response = (await client.chat.completions.create(
      {
        model,
        ...samplingFields,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "answer_draft_review",
            strict: true,
            schema: REVIEW_JSON_SCHEMA,
          },
        },
        messages: [
          { role: "system", content: REVIEW_SYSTEM_PROMPT },
          { role: "user", content: buildReviewUserPrompt(input) },
        ],
      } as Parameters<typeof client.chat.completions.create>[0],
      options.signal ? { signal: options.signal } : undefined,
    )) as ChatCompletion;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new AnswerReviewSystemError(`Review API error: ${message}`);
  }

  const latencyMs = performance.now() - started;
  const rawText = response.choices[0]?.message?.content ?? "";
  if (!rawText.trim()) {
    throw new AnswerReviewSystemError("Review API returned empty content.");
  }

  const payload = parseReviewResultPayload(
    rawText,
    input.contextChunks,
    input.draft.answerParts.length,
  );

  return {
    payload,
    model,
    rawText,
    latencyMs,
    usage: {
      promptTokens: response.usage?.prompt_tokens,
      completionTokens: response.usage?.completion_tokens,
      totalTokens: response.usage?.total_tokens,
      cachedInputTokens: response.usage?.prompt_tokens_details?.cached_tokens,
    },
  };
}
