"use client";

import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  useRemoteThreadListRuntime,
} from "@assistant-ui/react";
import { useMemo, type ReactNode } from "react";
import { createOfekThreadListAdapter } from "@/lib/ofek-thread-list-adapter";
import { ragChatModelAdapter } from "@/lib/rag-chat-model-adapter";

/** Per-thread LocalRuntime hook required by useRemoteThreadListRuntime. */
function useOfekLocalRuntime() {
  return useLocalRuntime(ragChatModelAdapter);
}

/**
 * Runtime stays outside the HomeDemo visual shell.
 * Active path: RemoteThreadList (localStorage) + LocalRuntime + ragChatModelAdapter
 * → POST /api/ask → ask().
 * Titles: POST /api/thread-title (separate, non-blocking for ask).
 * Browser localStorage persists threads for display; the active-branch history
 * window is also sent to /api/ask for follow-up rewriting (Stage 2).
 */
export function DemoRuntimeProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  const adapter = useMemo(() => createOfekThreadListAdapter(), []);

  const runtime = useRemoteThreadListRuntime({
    runtimeHook: useOfekLocalRuntime,
    adapter,
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {children}
    </AssistantRuntimeProvider>
  );
}
