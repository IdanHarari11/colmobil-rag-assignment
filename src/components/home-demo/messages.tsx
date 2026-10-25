"use client";

import {
  ActionBarPrimitive,
  AuiIf,
  BranchPickerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  type TextMessagePartComponent,
} from "@assistant-ui/react";
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  PencilIcon,
  RefreshCwIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { MarkdownText } from "@/components/assistant-ui/elements/markdown-text";
import { cn } from "@/lib/utils";
import {
  PartCitations,
  Sources,
  useCitationNumbers,
  useMessageRag,
} from "./sources";
import { actionButtonClass } from "./styles";

const BidirectionalText: TextMessagePartComponent = ({ text }) => (
  <p dir="auto" className="whitespace-pre-wrap">
    {text}
  </p>
);

export function UserMessage(): ReactNode {
  return (
    <MessagePrimitive.Root
      data-role="user"
      className="animate-in fade-in slide-in-from-bottom-1 mx-auto flex w-full max-w-(--thread-max-width) flex-col items-end duration-150"
    >
      <div className="relative max-w-[80%]">
        <div
          dir="auto"
          className="peer bg-muted rounded-thread px-4 py-2 text-[15px] wrap-break-word empty:hidden"
        >
          <MessagePrimitive.Parts components={{ Text: BidirectionalText }} />
        </div>
        <ActionBarPrimitive.Root
          hideWhenRunning
          autohide="not-last"
          className="absolute end-full top-1/2 -translate-y-1/2 pe-1.5 peer-empty:hidden"
        >
          <ActionBarPrimitive.Edit
            aria-label="עריכת הודעה"
            className={actionButtonClass}
          >
            <PencilIcon className="size-4" />
          </ActionBarPrimitive.Edit>
        </ActionBarPrimitive.Root>
      </div>
      <BranchPicker className="-me-1 mt-1" />
    </MessagePrimitive.Root>
  );
}

function AssistantBody(): ReactNode {
  const rag = useMessageRag();
  const numbers = useCitationNumbers(rag);

  if (rag && rag.answerParts.length > 0 && rag.status === "answered") {
    return (
      <div dir="auto" className="flex flex-col gap-3 text-[15px] leading-relaxed">
        {rag.answerParts.map((part, index) => (
          <p key={`${index}-${part.text.slice(0, 24)}`} className="wrap-break-word">
            <span className="whitespace-pre-wrap">{part.text}</span>
            <PartCitations
              sourceChunkIds={part.sourceChunkIds}
              sources={rag.sources}
              numbers={numbers}
            />
          </p>
        ))}
      </div>
    );
  }

  // clarification / insufficient / fallback: render the text part via markdown (safe).
  return (
    <MessagePrimitive.Parts
      components={{
        Text: MarkdownText,
      }}
    />
  );
}

export function AssistantMessage(): ReactNode {
  return (
    <MessagePrimitive.Root
      data-role="assistant"
      className="animate-in fade-in slide-in-from-bottom-1 mx-auto w-full max-w-(--thread-max-width) duration-150"
    >
      <div dir="auto" className="text-[15px] leading-relaxed wrap-break-word">
        <AuiIf condition={(s) => s.message.status?.type === "running"}>
          <p className="text-muted-foreground text-[13px]" role="status">
            מכין תשובה…
          </p>
        </AuiIf>
        <AuiIf condition={(s) => s.message.status?.type !== "running"}>
          <AssistantBody />
          <Sources />
        </AuiIf>
        <MessagePrimitive.Error>
          <ErrorPrimitive.Root className="text-destructive mt-2 border-s-2 border-destructive/60 ps-3 text-[13px]">
            <ErrorPrimitive.Message className="line-clamp-3" />
            <div className="mt-2">
              <ActionBarPrimitive.Reload
                aria-label="נסה שוב"
                className={cn(
                  actionButtonClass,
                  "text-destructive hover:text-destructive border-destructive/30 border px-2",
                )}
              >
                <RefreshCwIcon className="size-3.5" />
                <span className="ms-1 text-[12px]">נסה שוב</span>
              </ActionBarPrimitive.Reload>
            </div>
          </ErrorPrimitive.Root>
        </MessagePrimitive.Error>
      </div>
      <div className="mt-2 flex items-center gap-1.5 empty:hidden">
        <BranchPicker />
        <AssistantActionBar />
      </div>
    </MessagePrimitive.Root>
  );
}

function BranchPicker({ className }: { className?: string }): ReactNode {
  return (
    <BranchPickerPrimitive.Root
      hideWhenSingleBranch
      className={cn(
        "text-muted-foreground inline-flex items-center text-xs",
        className,
      )}
    >
      <BranchPickerPrimitive.Previous asChild>
        <button
          type="button"
          className={actionButtonClass}
          aria-label="גרסה קודמת"
        >
          <ChevronLeftIcon className="size-3.5 rtl:-scale-x-100" />
        </button>
      </BranchPickerPrimitive.Previous>
      <span dir="ltr" className="inline-flex items-center gap-0.5 tabular-nums">
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next asChild>
        <button
          type="button"
          className={actionButtonClass}
          aria-label="גרסה הבאה"
        >
          <ChevronRightIcon className="size-3.5 rtl:-scale-x-100" />
        </button>
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  );
}

function AssistantActionBar(): ReactNode {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="flex items-center gap-1.5"
    >
      <ActionBarPrimitive.Copy
        aria-label="העתקת תשובה"
        className={actionButtonClass}
      >
        <AuiIf condition={(s) => s.message.isCopied}>
          <CheckIcon className="size-4" />
        </AuiIf>
        <AuiIf condition={(s) => !s.message.isCopied}>
          <CopyIcon className="size-4" />
        </AuiIf>
      </ActionBarPrimitive.Copy>
      <ActionBarPrimitive.Reload
        aria-label="יצירה מחדש"
        className={actionButtonClass}
      >
        <RefreshCwIcon className="size-4" />
      </ActionBarPrimitive.Reload>
    </ActionBarPrimitive.Root>
  );
}
