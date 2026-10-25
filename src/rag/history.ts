/**
 * Conversation history window for Stage 2 (query rewriting).
 * Prior turns only — the new user question is passed separately and must not
 * be duplicated here. Oldest complete turns are dropped when over budget.
 */

export type ChatHistoryRole = "user" | "assistant";

export interface ChatHistoryMessage {
  role: ChatHistoryRole;
  content: string;
}

/** Max prior user↔assistant turns retained (a turn = one user + optional assistant). */
export const HISTORY_MAX_TURNS = 6;

/** Soft cap on total characters across retained history messages. */
export const HISTORY_MAX_TOTAL_CHARS = 6000;

/** Per-message character cap after trim (server rejects longer inputs). */
export const HISTORY_MAX_MESSAGE_CHARS = 2000;

export const HISTORY_WINDOW_NOTES = [
  `Prior history is capped at ${HISTORY_MAX_TURNS} turns (user + optional assistant reply).`,
  `Total retained history text ≤ ${HISTORY_MAX_TOTAL_CHARS} characters; oldest turns are dropped whole.`,
  "Dropped history is not assumed known. The new question is never included in history.",
  "Only user/assistant text is accepted — no system/developer roles from the client.",
] as const;

export class HistoryValidationError extends Error {
  readonly code: string;

  constructor(message: string, code = "invalid_history") {
    super(message);
    this.name = "HistoryValidationError";
    this.code = code;
  }
}

function isHistoryRole(value: unknown): value is ChatHistoryRole {
  return value === "user" || value === "assistant";
}

/**
 * Validate and normalize client-supplied history.
 * Rejects system/developer and malformed entries.
 */
export function parseAndValidateHistory(
  raw: unknown,
): ChatHistoryMessage[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new HistoryValidationError(
      "history must be an array of { role, content }.",
      "invalid_history_type",
    );
  }
  if (raw.length === 0) return [];

  const messages: ChatHistoryMessage[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const entry = raw[i];
    if (!entry || typeof entry !== "object") {
      throw new HistoryValidationError(
        `history[${i}] must be an object.`,
        "invalid_history_entry",
      );
    }
    const obj = entry as Record<string, unknown>;
    if (obj.role === "system" || obj.role === "developer") {
      throw new HistoryValidationError(
        "history must not include system or developer roles.",
        "forbidden_history_role",
      );
    }
    if (!isHistoryRole(obj.role)) {
      throw new HistoryValidationError(
        `history[${i}].role must be "user" or "assistant".`,
        "invalid_history_role",
      );
    }
    if (typeof obj.content !== "string") {
      throw new HistoryValidationError(
        `history[${i}].content must be a string.`,
        "invalid_history_content",
      );
    }
    const content = obj.content.trim();
    if (!content) {
      throw new HistoryValidationError(
        `history[${i}].content must be non-empty.`,
        "empty_history_content",
      );
    }
    if (content.length > HISTORY_MAX_MESSAGE_CHARS) {
      throw new HistoryValidationError(
        `history[${i}].content exceeds ${HISTORY_MAX_MESSAGE_CHARS} characters.`,
        "history_message_too_long",
      );
    }
    messages.push({ role: obj.role, content });
  }
  return messages;
}

/**
 * Group messages into turns: each user message starts a turn;
 * a following assistant message (if any) completes it.
 */
export function groupHistoryTurns(
  messages: readonly ChatHistoryMessage[],
): ChatHistoryMessage[][] {
  const turns: ChatHistoryMessage[][] = [];
  let i = 0;
  while (i < messages.length) {
    const current = messages[i]!;
    if (current.role === "user") {
      const turn: ChatHistoryMessage[] = [current];
      if (messages[i + 1]?.role === "assistant") {
        turn.push(messages[i + 1]!);
        i += 2;
      } else {
        i += 1;
      }
      turns.push(turn);
      continue;
    }
    // Orphan assistant — treat as its own turn so we do not invent a user.
    turns.push([current]);
    i += 1;
  }
  return turns;
}

/**
 * Keep the newest turns within turn count and total character budget.
 * Drops oldest turns entirely (never mid-message).
 */
export function applyHistoryWindow(
  messages: readonly ChatHistoryMessage[],
  options?: {
    maxTurns?: number;
    maxTotalChars?: number;
  },
): ChatHistoryMessage[] {
  const maxTurns = options?.maxTurns ?? HISTORY_MAX_TURNS;
  const maxTotalChars = options?.maxTotalChars ?? HISTORY_MAX_TOTAL_CHARS;
  const turns = groupHistoryTurns(messages);
  const keptTurns: ChatHistoryMessage[][] = [];
  let totalChars = 0;

  for (let t = turns.length - 1; t >= 0; t -= 1) {
    if (keptTurns.length >= maxTurns) break;
    const turn = turns[t]!;
    const turnChars = turn.reduce((sum, m) => sum + m.content.length, 0);
    if (keptTurns.length > 0 && totalChars + turnChars > maxTotalChars) {
      break;
    }
    keptTurns.unshift(turn);
    totalChars += turnChars;
  }

  return keptTurns.flat();
}

export function formatHistoryForPrompt(
  messages: readonly ChatHistoryMessage[],
): string {
  if (messages.length === 0) return "(no history)";
  return messages
    .map((m) => {
      const label = m.role === "user" ? "User" : "Assistant";
      return `${label}:\n${m.content}`;
    })
    .join("\n\n");
}
