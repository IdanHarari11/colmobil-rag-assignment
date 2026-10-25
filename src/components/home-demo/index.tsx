"use client";

import { useState, type ReactNode } from "react";
import { DemoRuntimeProvider } from "@/components/demo-runtime/demo-runtime-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DemoShell } from "./shell";

/**
 * Adapted from assistant-ui HomeDemo
 * Source: apps/docs/components/pages/home/demo
 * Commit: 9845a8ba8a3c736bc200277ec00acc2d7b3b3ada
 * License: MIT (see docs/licenses/assistant-ui-MIT.txt)
 *
 * Runtime (DemoRuntimeProvider) stays outside the visual shell.
 * Active path: localStorage RemoteThreadList + LocalRuntime +
 * ragChatModelAdapter → POST /api/ask → ask().
 * History is browser-local display only — not model memory.
 */
export function HomeDemo(): ReactNode {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <TooltipProvider>
      <DemoRuntimeProvider>
        <section aria-label="Thread" className="bg-background h-dvh">
          <DemoShell
            sidebarCollapsed={sidebarCollapsed}
            onSidebarCollapsedChange={setSidebarCollapsed}
          />
        </section>
      </DemoRuntimeProvider>
    </TooltipProvider>
  );
}
