import OpenAI from "openai";
import { getOpenAiApiKey, loadEnv } from "@/rag/env";
import { getGenerationModel } from "@/rag/generate";
import {
  fallbackTitleFromQuestion,
  normalizeGeneratedTitle,
} from "@/lib/thread-title";

const TITLE_SYSTEM_PROMPT = [
  'You generate a short Hebrew thread title for a support chat at the fictional insurance company "Ofek Insurance".',
  "Input is the user's first question only.",
  "Return JSON with a title field only.",
  "",
  "Rules:",
  "- Title in Hebrew, usually 3–7 words, up to 60 characters.",
  "- Describe the request/topic — do not decide the answer.",
  "- Do not invent a product, details, or conclusion the user did not state.",
  "- Do not include ID numbers, phone numbers, emails, or contact details.",
  '- Do not add quotes or a prefix like "Title:".',
].join("\n");

const TITLE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title"],
  properties: {
    title: { type: "string" },
  },
} as const;

/**
 * Generate a short thread title from the first user question.
 * On any failure, returns a normalized fallback from the question text.
 * Separate from ask() — no corpus, sources, or answer payload.
 */
export async function generateThreadTitleFromQuestion(
  question: string,
): Promise<{ title: string; source: "model" | "fallback"; model?: string }> {
  const trimmed = question.trim();
  if (!trimmed) {
    return { title: fallbackTitleFromQuestion(""), source: "fallback" };
  }

  loadEnv();
  const apiKey = getOpenAiApiKey({ required: false });
  if (!apiKey) {
    return {
      title: fallbackTitleFromQuestion(trimmed),
      source: "fallback",
    };
  }

  const model = getGenerationModel();
  try {
    const client = new OpenAI({ apiKey });
    const response = await client.chat.completions.create({
      model,
      temperature: 0,
      max_tokens: 80,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "thread_title",
          strict: true,
          schema: TITLE_JSON_SCHEMA,
        },
      },
      messages: [
        { role: "system", content: TITLE_SYSTEM_PROMPT },
        { role: "user", content: trimmed },
      ],
    });

    const raw = response.choices[0]?.message?.content ?? "";
    const parsed = JSON.parse(raw) as { title?: unknown };
    const normalized =
      typeof parsed.title === "string"
        ? normalizeGeneratedTitle(parsed.title)
        : null;

    if (normalized) {
      return { title: normalized, source: "model", model };
    }
  } catch {
    // Fall through to deterministic fallback — never block chat on title errors.
  }

  return {
    title: fallbackTitleFromQuestion(trimmed),
    source: "fallback",
    model,
  };
}
