/** Empty / default thread title shown before the first user message. */
export const DEFAULT_THREAD_TITLE = "שיחה חדשה";

const MAX_TITLE_CHARS = 60;
const MAX_TITLE_WORDS = 7;
const MIN_TITLE_WORDS = 1;

/** Israeli ID-like (9 digits), phone-like, and email patterns to strip from titles. */
const PII_PATTERNS: RegExp[] = [
  /\b\d{9}\b/g,
  /\b(?:\+972[-\s]?|0)(?:5\d|[2-489])[-\s]?\d{3}[-\s]?\d{4}\b/g,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
];

const LEADING_QUESTION_WORDS =
  /^(?:מה|איזה|איזו|אילו|האם|כמה|מתי|איך|כיצד|למה|מדוע|היכן|איפה|מי|למי|על\s+מה|באיזה|באיזו)\s+/u;

/**
 * Strip contact / identity fragments so titles never echo PII from the question.
 */
export function stripPiiFromTitleText(text: string): string {
  let result = text;
  for (const pattern of PII_PATTERNS) {
    result = result.replace(pattern, " ");
  }
  return result.replace(/\s+/g, " ").trim();
}

/**
 * Deterministic fallback when the title model fails or is unavailable.
 * Shortens and normalizes the user question — does not invent products or answers.
 */
export function fallbackTitleFromQuestion(question: string): string {
  const cleaned = stripPiiFromTitleText(question)
    .replace(/[?؟!.]+$/u, "")
    .replace(/["'`״׳]/g, "")
    .trim();

  if (!cleaned) return DEFAULT_THREAD_TITLE;

  let body = cleaned.replace(LEADING_QUESTION_WORDS, "").trim() || cleaned;
  body = body.replace(/\s+/g, " ");

  const words = body.split(" ").filter(Boolean);
  const sliced = words.slice(0, MAX_TITLE_WORDS);
  let title = sliced.join(" ");

  if (title.length > MAX_TITLE_CHARS) {
    title = title.slice(0, MAX_TITLE_CHARS).replace(/\s+\S*$/u, "").trim();
  }

  if (!title || title.split(" ").filter(Boolean).length < MIN_TITLE_WORDS) {
    return DEFAULT_THREAD_TITLE;
  }

  return title;
}

/**
 * Normalize a model-produced title: trim, strip PII, enforce length bounds.
 * Returns null when the result is empty or unsafe.
 */
export function normalizeGeneratedTitle(raw: string): string | null {
  const stripped = stripPiiFromTitleText(raw)
    .replace(/^["'«]|["'»]$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!stripped) return null;
  if (/^(new\s+chat|new\s+thread|untitled)$/i.test(stripped)) return null;

  const words = stripped.split(" ").filter(Boolean);
  const sliced = words.slice(0, MAX_TITLE_WORDS);
  let title = sliced.join(" ");

  if (title.length > MAX_TITLE_CHARS) {
    title = title.slice(0, MAX_TITLE_CHARS).replace(/\s+\S*$/u, "").trim();
  }

  return title || null;
}

export function firstUserTextFromMessages(
  messages: ReadonlyArray<{
    role: string;
    content: ReadonlyArray<{ type: string; text?: string }>;
  }>,
): string {
  for (const message of messages) {
    if (message.role !== "user") continue;
    const text = message.content
      .filter(
        (part): part is { type: "text"; text: string } =>
          part.type === "text" && typeof part.text === "string",
      )
      .map((part) => part.text)
      .join("\n")
      .trim();
    if (text) return text;
  }
  return "";
}
