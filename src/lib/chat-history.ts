import type { ThreadMessage } from "@assistant-ui/react";
import {
  applyHistoryWindow,
  type ChatHistoryMessage,
} from "@/rag/history";

function textFromMessage(message: ThreadMessage): string {
  return message.content
    .filter(
      (part): part is { type: "text"; text: string } => part.type === "text",
    )
    .map((part) => part.text)
    .join("\n")
    .trim();
}

/**
 * Build prior-turn history for /api/ask from the active branch messages.
 * The newest user message is the current question and is excluded.
 * Only user/assistant text — no metadata, sources, or other roles.
 */
export function buildAskHistoryFromThreadMessages(
  messages: readonly ThreadMessage[],
): { question: string; history: ChatHistoryMessage[] } {
  let lastUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "user") {
      lastUserIndex = i;
      break;
    }
  }
  if (lastUserIndex < 0) {
    return { question: "", history: [] };
  }

  const question = textFromMessage(messages[lastUserIndex]!);
  const prior: ChatHistoryMessage[] = [];
  for (let i = 0; i < lastUserIndex; i += 1) {
    const message = messages[i]!;
    if (message.role !== "user" && message.role !== "assistant") continue;
    const content = textFromMessage(message);
    if (!content) continue;
    prior.push({ role: message.role, content });
  }

  return {
    question,
    history: applyHistoryWindow(prior),
  };
}
