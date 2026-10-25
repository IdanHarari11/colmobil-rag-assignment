"use client";

import { AuiIf, ThreadPrimitive, useAuiState } from "@assistant-ui/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const SUGGESTIONS = [
  {
    label: "שעות מוקד בשישי",
    prompt: "מה שעות הפעילות של מוקד שירות הלקוחות ביום שישי?",
  },
  {
    label: "טופס ביטול",
    prompt: "איזה טופס ממלאים כדי לבקש ביטול פוליסה?",
  },
  {
    label: "ביטוח חיות מחמד",
    prompt: "האם אופק ביטוח מציעה ביטוח לחיות מחמד?",
  },
  {
    label: "איחור כבודה",
    prompt: "המזוודה של נוסע הגיעה באיחור של 8 שעות. לכמה פיצוי הוא זכאי?",
  },
  {
    label: "רכב חלופי",
    prompt: "האם רכב חלופי ניתן לכל תקופת התיקון?",
  },
  {
    label: "נהג צעיר",
    prompt:
      "נהג בן 22 נהג ברכב עם פוליסת 'כל נהג' בלי נספח נהג צעיר ועשה תאונה. האם יש כיסוי?",
  },
];
const suggestionChipClass =
  "border-foreground/10 bg-background text-muted-foreground hover:border-foreground/25 hover:text-foreground rounded-control h-8 border px-3 text-[13px] transition-colors";

export function Suggestions(): ReactNode {
  const isComposerEmpty = useAuiState((s) => s.composer.isEmpty);

  return (
    <div
      inert={!isComposerEmpty}
      className={cn(
        "animate-in fade-in mx-auto flex max-w-[34rem] flex-wrap items-center justify-center gap-2 transition-opacity duration-200 motion-reduce:animate-none",
        !isComposerEmpty && "opacity-0",
      )}
    >
      {SUGGESTIONS.map((suggestion) => (
        <ThreadPrimitive.Suggestion
          key={suggestion.prompt}
          prompt={suggestion.prompt}
          send
          className={suggestionChipClass}
        >
          {suggestion.label}
        </ThreadPrimitive.Suggestion>
      ))}
    </div>
  );
}

export function FollowUps(): ReactNode {
  const suggestions = useAuiState((s) => s.thread.suggestions);

  return (
    <AuiIf
      condition={(s) =>
        !s.thread.isEmpty &&
        !s.thread.isRunning &&
        s.thread.suggestions.length > 0
      }
    >
      <div className="animate-in fade-in flex [scrollbar-width:none] gap-2 overflow-x-auto duration-200 motion-reduce:animate-none [&::-webkit-scrollbar]:hidden">
        {suggestions.map((suggestion) => (
          <ThreadPrimitive.Suggestion
            key={suggestion.prompt}
            prompt={suggestion.prompt}
            send
            className={cn(suggestionChipClass, "shrink-0 whitespace-nowrap")}
          >
            {suggestion.prompt}
          </ThreadPrimitive.Suggestion>
        ))}
      </div>
    </AuiIf>
  );
}
