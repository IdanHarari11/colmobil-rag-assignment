"use client";

import { useAui, useAuiState } from "@assistant-ui/react";
import { Menu } from "@base-ui/react/menu";
import { MoreHorizontalIcon, PanelLeftIcon } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { DEFAULT_THREAD_TITLE } from "@/lib/thread-title";
import { cn } from "@/lib/utils";
import { Sidebar } from "./sidebar";
import { menuContentClass, menuItemClass } from "./styles";
import { Thread } from "./thread";
import { ThreadRenameInput } from "./thread-rename-input";
import {
  getThreadCommands,
  getThreadShortcut,
  useIsApplePlatform,
  type ThreadCommand,
} from "./thread-shortcuts";

const SIDEBAR_REGION_ID = "aui-demo-sidebar";

export function DemoShell({
  sidebarCollapsed,
  onSidebarCollapsedChange: setSidebarCollapsed,
}: {
  sidebarCollapsed: boolean;
  onSidebarCollapsedChange: (collapsed: boolean) => void;
}): ReactNode {
  const rootRef = useRef<HTMLDivElement>(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const aui = useAui();
  const [renaming, setRenaming] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const pendingMobileAction = useRef<typeof renaming | "composer">(null);
  const onMobileSidebarOpenChange = (open: boolean) => {
    if (open) pendingMobileAction.current = null;
    setMobileSidebarOpen(open);
  };
  const focusComposer = () =>
    rootRef.current
      ?.querySelector<HTMLTextAreaElement>("[data-composer-input]")
      ?.focus();
  const mainThreadId = useAuiState((s) => s.threads.mainThreadId);
  if (renaming && renaming.id !== mainThreadId) setRenaming(null);
  const persisted = useAuiState((s) =>
    s.threads.threadItems.some(
      (item) => item.id === s.threads.mainThreadId && item.status !== "new",
    ),
  );
  const orderedThreadIds = useAuiState((s) => s.threads.threadIds);

  const runCommand = (command: ThreadCommand) => {
    if (command === "sidebar") {
      if (window.matchMedia("(max-width: 767px)").matches)
        onMobileSidebarOpenChange(!mobileSidebarOpen);
      else setSidebarCollapsed(!sidebarCollapsed);
      return;
    }
    if (command === "composer") {
      if (mobileSidebarOpen) {
        pendingMobileAction.current = "composer";
        setMobileSidebarOpen(false);
      } else requestAnimationFrame(focusComposer);
      return;
    }
    const state = aui.threads.getState();
    const item = state.threadItems.find(
      (entry) => entry.id === state.mainThreadId,
    );
    if (command === "rename") {
      if (item && item.status !== "new") {
        const target = { id: item.id, title: item.title ?? "" };
        if (mobileSidebarOpen) {
          pendingMobileAction.current = target;
          setMobileSidebarOpen(false);
        } else setRenaming(target);
      }
      return;
    }
    void Promise.resolve()
      .then(() => {
        if (command === "new") {
          setMobileSidebarOpen(false);
          return aui.threads.switchToNewThread();
        }
        if (command === "previous" || command === "next") {
          const index = orderedThreadIds.indexOf(state.mainThreadId);
          const next =
            index < 0
              ? command === "next"
                ? 0
                : orderedThreadIds.length - 1
              : index + (command === "next" ? 1 : -1);
          const id = orderedThreadIds[next];
          if (id) {
            setMobileSidebarOpen(false);
            return aui.threads.switchToThread(id);
          }
          return;
        }
        if (!item || item.status === "new") return;
        const client = aui.threads.item({ id: item.id });
        if (command === "archive")
          return item.status === "archived"
            ? client.unarchive()
            : client.archive();
        if (command === "pin") {
          const { pinned, ...custom } = item.custom ?? {};
          return client.updateCustom(
            pinned === "true" ? custom : { ...custom, pinned: "true" },
          );
        }
      })
      .catch(() => {
        // Keep UI quiet on switch / storage errors; do not claim success.
      });
  };

  return (
    <div
      ref={rootRef}
      onKeyDown={(event) => {
        const command = getThreadShortcut(event.nativeEvent);
        if (!command) return;
        event.preventDefault();
        runCommand(command);
      }}
      className={cn(
        "bg-background grid h-full grid-rows-[3rem_minmax(0,1fr)]",
        sidebarCollapsed
          ? "md:grid-cols-[minmax(0,1fr)]"
          : "md:grid-cols-[15rem_minmax(0,1fr)]",
      )}
    >
      {/* Sidebar header — first grid column = inline-start in LTR / inline-end in RTL (right). */}
      <div
        className={cn(
          "border-foreground/10 bg-foreground/[0.025] dark:bg-foreground/[0.04] hidden h-12 items-center gap-2 border-e border-b px-4",
          !sidebarCollapsed && "md:flex",
        )}
      >
        <span
          aria-hidden
          className="bg-foreground/80 block size-4 rounded-[3px]"
        />
        <span className="text-[13px] font-medium">אופק RAG</span>
        <button
          type="button"
          onClick={() => setSidebarCollapsed(true)}
          aria-label="כיווץ רשימת השיחות"
          aria-expanded
          aria-controls={SIDEBAR_REGION_ID}
          className="text-muted-foreground hover:text-foreground rounded-control ms-auto -me-1.5 grid size-7 shrink-0 place-items-center transition-colors"
        >
          <PanelLeftIcon className="size-4 rtl:-scale-x-100" />
        </button>
      </div>
      <div className="border-foreground/10 flex h-12 min-w-0 items-center gap-2 border-b px-4 md:px-5">
        <button
          type="button"
          onClick={() => onMobileSidebarOpenChange(true)}
          aria-label="פתיחת רשימת השיחות"
          className="text-muted-foreground hover:text-foreground rounded-control -ms-1.5 grid size-7 shrink-0 place-items-center transition-colors md:hidden"
        >
          <PanelLeftIcon className="size-4 rtl:-scale-x-100" />
        </button>
        {sidebarCollapsed ? (
          <button
            type="button"
            onClick={() => setSidebarCollapsed(false)}
            aria-label="הצגת רשימת השיחות"
            aria-expanded={false}
            aria-controls={SIDEBAR_REGION_ID}
            className="text-muted-foreground hover:text-foreground rounded-control -ms-1.5 hidden size-7 shrink-0 place-items-center transition-colors md:grid"
          >
            <PanelLeftIcon className="size-4 rtl:-scale-x-100" />
          </button>
        ) : null}
        {renaming && renaming.id === mainThreadId ? (
          <div className="max-w-sm min-w-0 flex-1">
            <ThreadRenameInput
              key={renaming.id}
              title={renaming.title}
              onRename={(title) =>
                aui.threads.item({ id: renaming.id }).rename(title)
              }
              onDone={(restoreFocus) => {
                setRenaming(null);
                if (restoreFocus)
                  rootRef.current
                    ?.querySelector<HTMLButtonElement>(
                      '[aria-label="אפשרויות שיחה"]',
                    )
                    ?.focus();
              }}
            />
          </div>
        ) : (
          <ThreadTitle />
        )}
        <div className="-me-1.5 ms-auto flex shrink-0 items-center gap-1.5">
          <span className="border-foreground/15 text-muted-foreground hidden rounded-control border px-2 py-0.5 text-[11px] sm:inline">
            אופק RAG
          </span>
          <DemoMenu onCommand={runCommand} persisted={persisted} />
        </div>
      </div>
      <div
        id={SIDEBAR_REGION_ID}
        className={cn(
          "border-foreground/10 bg-foreground/[0.025] dark:bg-foreground/[0.04] hidden min-h-0 flex-col overflow-hidden border-e p-3",
          !sidebarCollapsed && "md:flex",
        )}
      >
        <Sidebar />
      </div>
      <main
        className="min-h-0 min-w-0"
        style={{ ["--thread-max-width" as string]: "42rem" }}
      >
        <Thread />
      </main>
      <Sheet
        open={mobileSidebarOpen}
        onOpenChange={onMobileSidebarOpenChange}
        onOpenChangeComplete={(open) => {
          if (open) return;
          if (pendingMobileAction.current === "composer") focusComposer();
          else if (pendingMobileAction.current)
            setRenaming(pendingMobileAction.current);
        }}
      >
        <SheetContent
          side="right"
          className="bg-background w-72 overflow-hidden p-3 pt-12"
          finalFocus={() => pendingMobileAction.current === null}
          onKeyDownCapture={(event) => {
            if (getThreadShortcut(event.nativeEvent) !== "composer") return;
            event.preventDefault();
            event.stopPropagation();
            runCommand("composer");
          }}
        >
          <SheetTitle className="sr-only">רשימת שיחות</SheetTitle>
          <Sidebar
            onNavigate={() => {
              setMobileSidebarOpen(false);
            }}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ThreadTitle(): ReactNode {
  const title = useAuiState(
    (s) =>
      s.threads.threadItems.find((t) => t.id === s.threads.mainThreadId)?.title,
  );

  return (
    <span className="min-w-0 truncate text-[13px] font-medium" dir="auto">
      {title?.trim() || DEFAULT_THREAD_TITLE}
    </span>
  );
}

function DemoMenu({
  onCommand,
  persisted,
}: {
  onCommand: (command: ThreadCommand) => void;
  persisted: boolean;
}): ReactNode {
  const pendingCommand = useRef<ThreadCommand | null>(null);
  const commands = getThreadCommands(useIsApplePlatform());
  return (
    <Menu.Root
      onOpenChange={(open) => {
        if (open) pendingCommand.current = null;
      }}
      onOpenChangeComplete={(open) => {
        if (open || !pendingCommand.current) return;
        onCommand(pendingCommand.current);
      }}
    >
      <Menu.Trigger
        aria-label="אפשרויות שיחה"
        render={
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground rounded-control data-[popup-open]:text-foreground grid size-7 place-items-center transition-colors"
          />
        }
      >
        <MoreHorizontalIcon className="size-4" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          className="isolate z-50 outline-none"
          side="bottom"
          align="end"
          sideOffset={6}
        >
          <Menu.Popup
            className={menuContentClass}
            finalFocus={() =>
              pendingCommand.current !== "rename" &&
              pendingCommand.current !== "composer"
            }
          >
            {commands.map((command) => (
              <Menu.Item
                key={command.id}
                className={cn(menuItemClass, "justify-between gap-6")}
                disabled={
                  !persisted &&
                  ["rename", "archive", "pin"].includes(command.id)
                }
                onClick={() => {
                  pendingCommand.current = command.id;
                }}
              >
                <span>{command.label}</span>
                <kbd className="text-muted-foreground font-mono text-[10px]" dir="ltr">
                  {command.shortcut}
                </kbd>
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
