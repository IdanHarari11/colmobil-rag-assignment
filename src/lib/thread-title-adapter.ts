import type { TitleGenerationAdapter, ThreadMessage } from "@assistant-ui/react";
import {
  DEFAULT_THREAD_TITLE,
  fallbackTitleFromQuestion,
  firstUserTextFromMessages,
} from "@/lib/thread-title";

/**
 * Client title generator: POST /api/thread-title (separate from ask).
 * Falls back to a normalized short title from the question on any failure.
 */
export function createOfekTitleGenerationAdapter(): TitleGenerationAdapter {
  return {
    async generateTitle(messages: readonly ThreadMessage[]): Promise<string> {
      const question = firstUserTextFromMessages(messages);
      if (!question) return DEFAULT_THREAD_TITLE;

      try {
        const response = await fetch("/api/thread-title", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question }),
        });
        if (!response.ok) {
          return fallbackTitleFromQuestion(question);
        }
        const data = (await response.json()) as { title?: unknown };
        if (typeof data.title === "string" && data.title.trim()) {
          return data.title.trim();
        }
      } catch {
        // Network / parse errors → local fallback.
      }
      return fallbackTitleFromQuestion(question);
    },
  };
}
