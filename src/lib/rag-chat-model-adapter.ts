import type { ChatModelAdapter, ThreadMessage } from "@assistant-ui/react";
import {
  ASK_CUSTOM_METADATA_KEY,
  isAskDisplayResponse,
  type AskDisplayResponse,
} from "@/lib/ask-display";
import { buildAskHistoryFromThreadMessages } from "@/lib/chat-history";
import { HE_API_ERRORS } from "@/lib/user-facing-he";

/**
 * LocalRuntime adapter: browser → POST /api/ask → same ask() as the CLI.
 * Sends prior user/assistant turns from the active branch (not the new question).
 * No streaming. Structured RAG payload goes in metadata.custom (not answer text).
 */
export const ragChatModelAdapter: ChatModelAdapter = {
  async run({ messages, abortSignal }) {
    const { question, history } = buildAskHistoryFromThreadMessages(messages);
    if (!question) {
      throw new Error(HE_API_ERRORS.missingUserQuestion);
    }

    const body: { question: string; history?: typeof history } = { question };
    if (history.length > 0) {
      body.history = history;
    }

    const response = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: abortSignal,
    });

    if (abortSignal.aborted) {
      throw new DOMException("Request aborted", "AbortError");
    }

    if (!response.ok) {
      let message: string = HE_API_ERRORS.internalError;
      try {
        const payload = (await response.json()) as { error?: string };
        if (typeof payload.error === "string" && payload.error.trim()) {
          message = payload.error.trim();
        }
      } catch {
        // keep default safe message
      }
      throw new Error(message);
    }

    const data: unknown = await response.json();
    if (abortSignal.aborted) {
      throw new DOMException("Request aborted", "AbortError");
    }
    if (!isAskDisplayResponse(data)) {
      throw new Error(HE_API_ERRORS.invalidServerPayload);
    }

    const display: AskDisplayResponse = data;
    return {
      content: [{ type: "text", text: display.answer }],
      status: { type: "complete", reason: "stop" },
      metadata: {
        custom: {
          [ASK_CUSTOM_METADATA_KEY]: display,
        },
      },
    };
  },
};

// Re-export for tests that previously imported last-user helpers via adapter file.
export function lastUserText(messages: readonly ThreadMessage[]): string {
  return buildAskHistoryFromThreadMessages(messages).question;
}
