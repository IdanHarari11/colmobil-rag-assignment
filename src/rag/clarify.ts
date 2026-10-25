import OpenAI from "openai";
import { getOpenAiApiKey, loadEnv } from "./env";
import { GenerationSystemError } from "./ask-types";
import { getGenerationModel } from "./generate";

/**
 * HISTORICAL / UNUSED on the active ask() path (rejected after Stage 5.2).
 * Pre-retrieve clarify fixed one ambiguity case (D05-like) but caused widespread
 * over-clarification on answerable questions. Kept for audit only — do not wire into ask().
 *
 * Pre-retrieval ambiguity gate.
 * Sees only the user question — no corpus, no retrieval hits, no dev_set.
 */
export interface ClarificationDecision {
  needsClarification: boolean;
  missingDetails: string[];
  clarificationQuestion: string;
}

export interface ClarifyResult {
  decision: ClarificationDecision;
  rawText: string;
  model: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  latencyMs: number;
}

const CLARIFY_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["needsClarification", "missingDetails", "clarificationQuestion"],
  properties: {
    needsClarification: { type: "boolean" },
    missingDetails: {
      type: "array",
      items: { type: "string" },
    },
    clarificationQuestion: { type: "string" },
  },
} as const;

export const CLARIFY_SYSTEM_PROMPT = [
  "You classify whether an insurance-agent user question needs clarification before any document lookup.",
  "Output JSON only. Do NOT answer the insurance question. Do NOT invent facts, products, or amounts.",
  "",
  "Set needsClarification=true ONLY when a missing detail would materially change the answer",
  "(e.g. product/line of business, event type, or policy version when the question hinges on it).",
  "Do NOT require a product type when the question is already specific enough from its wording alone",
  "(e.g. call-center hours, a form number to use for a named action, a clearly scoped factual ask).",
  "Questions about hours of service or which form to fill for a stated procedure usually do NOT need clarification.",
  "If needsClarification=true: fill missingDetails with short labels, and clarificationQuestion with ONE short Hebrew question.",
  "If needsClarification=false: missingDetails=[] and clarificationQuestion=\"\".",
].join("\n");

export function buildClarifyUserPrompt(question: string): string {
  return `User question (Hebrew possible):\n${question}`;
}

export function parseClarificationDecision(raw: string): ClarificationDecision {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new GenerationSystemError("Clarification step returned non-JSON output.");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new GenerationSystemError("Clarification JSON root must be an object.");
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.needsClarification !== "boolean") {
    throw new GenerationSystemError(
      "Clarification JSON missing boolean needsClarification.",
    );
  }
  if (
    !Array.isArray(obj.missingDetails) ||
    !obj.missingDetails.every((x) => typeof x === "string")
  ) {
    throw new GenerationSystemError(
      "Clarification JSON missingDetails must be string[].",
    );
  }
  if (typeof obj.clarificationQuestion !== "string") {
    throw new GenerationSystemError(
      "Clarification JSON missing string clarificationQuestion.",
    );
  }

  const decision: ClarificationDecision = {
    needsClarification: obj.needsClarification,
    missingDetails: obj.missingDetails.map((x) => x.trim()).filter(Boolean),
    clarificationQuestion: obj.clarificationQuestion.trim(),
  };

  if (decision.needsClarification && !decision.clarificationQuestion) {
    throw new GenerationSystemError(
      "Clarification required but clarificationQuestion is empty.",
    );
  }
  if (!decision.needsClarification) {
    decision.missingDetails = [];
    decision.clarificationQuestion = "";
  }

  return decision;
}

export async function assessClarificationNeeded(options: {
  question: string;
  model?: string;
  apiKey?: string;
}): Promise<ClarifyResult> {
  loadEnv();
  const model = options.model ?? getGenerationModel();
  const apiKey = options.apiKey ?? getOpenAiApiKey({ required: true });
  const client = new OpenAI({ apiKey });

  const started = performance.now();
  let response;
  try {
    response = await client.chat.completions.create({
      model,
      temperature: 0,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "clarification_gate",
          strict: true,
          schema: CLARIFY_JSON_SCHEMA,
        },
      },
      messages: [
        { role: "system", content: CLARIFY_SYSTEM_PROMPT },
        {
          role: "user",
          content: buildClarifyUserPrompt(options.question),
        },
      ],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new GenerationSystemError(`Clarification API error: ${message}`);
  }
  const latencyMs = performance.now() - started;

  const rawText = response.choices[0]?.message?.content ?? "";
  if (!rawText.trim()) {
    throw new GenerationSystemError("Clarification API returned empty content.");
  }

  const decision = parseClarificationDecision(rawText);
  return {
    decision,
    rawText,
    model,
    usage: {
      promptTokens: response.usage?.prompt_tokens,
      completionTokens: response.usage?.completion_tokens,
      totalTokens: response.usage?.total_tokens,
    },
    latencyMs,
  };
}
