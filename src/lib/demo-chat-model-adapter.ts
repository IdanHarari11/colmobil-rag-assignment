import type { ChatModelAdapter } from "@assistant-ui/react";

export const DEMO_ASSISTANT_REPLY =
  "מצב הדגמה: הממשק פועל. עדיין לא חוברו מודל או מסמכי מקור.";

/**
 * LocalRuntime ChatModelAdapter used only for Stage 1 UI verification.
 * Replace this adapter (or swap the runtime) when connecting the RAG core.
 */
export const demoChatModelAdapter: ChatModelAdapter = {
  async run() {
    return {
      content: [{ type: "text", text: DEMO_ASSISTANT_REPLY }],
      status: { type: "complete", reason: "stop" },
    };
  },
};
