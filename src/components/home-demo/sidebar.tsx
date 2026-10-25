"use client";

import { ThreadListPrimitive, useAui, useAuiState } from "@assistant-ui/react";
import { ChevronDownIcon, PlusIcon } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { SidebarNavigationContext } from "./sidebar-context";
import { threadListItemComponents } from "./thread-list-item";
import {
  getCommandShortcutLabels,
  useIsApplePlatform,
} from "./thread-shortcuts";

const sidebarLabelClass =
  "text-muted-foreground mt-5 mb-1 px-2 text-xs font-medium";

const SIDEBAR_SKELETON_WIDTHS = [
  "w-full",
  "w-4/5",
  "w-11/12",
  "w-3/5",
  "w-4/5",
];

export function Sidebar({
  onNavigate,
}: {
  onNavigate?: (() => void) | undefined;
}): ReactNode {
  const navigation = useMemo(() => ({ onNavigate }), [onNavigate]);
  const newThreadShortcut = getCommandShortcutLabels(
    "new",
    useIsApplePlatform(),
  );

  return (
    <SidebarNavigationContext.Provider value={navigation}>
      <ThreadListPrimitive.Root className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0">
          <ThreadListPrimitive.New asChild>
            <button
              type="button"
              onClick={onNavigate}
              title={`שיחה חדשה (${newThreadShortcut.display})`}
              aria-keyshortcuts={newThreadShortcut.aria}
              className="border-foreground/10 bg-background hover:border-foreground/25 rounded-control flex h-8 w-full shrink-0 items-center gap-2 border px-2.5 text-[13px] transition-colors"
            >
              <PlusIcon className="size-3.5" />
              שיחה חדשה
            </button>
          </ThreadListPrimitive.New>
        </div>
        <div className="-mx-3 min-h-0 flex-1 overflow-y-auto px-3">
          <ThreadList />
        </div>
        <div
          className="border-foreground/10 text-muted-foreground mt-3 border-t px-2 pt-3 text-[11px] leading-relaxed"
          dir="rtl"
        >
          השיחות נשמרות בדפדפן הזה בלבד (לא בענן). אפשר לשאול שאלות המשך באותה
          שיחה (חלון היסטוריה מוגבל בשרת).
        </div>
      </ThreadListPrimitive.Root>
    </SidebarNavigationContext.Provider>
  );
}

function ThreadList(): ReactNode {
  const aui = useAui();
  const isLoading = useAuiState((s) => s.threads.isLoading);
  const hasLoadError = useAuiState((s) => s.threads.loadError !== undefined);
  const hasThreads = useAuiState((s) => s.threads.threadIds.length > 0);
  const hasArchived = useAuiState(
    (s) => s.threads.archivedThreadIds.length > 0,
  );
  if (!isLoading && !hasLoadError && !hasThreads && !hasArchived) return null;

  const showLoadError =
    !isLoading && hasLoadError && !hasThreads && !hasArchived;

  return (
    <>
      {isLoading && !hasThreads ? (
        <div
          role="status"
          aria-label="טוען שיחות"
          className="mt-5 flex flex-col gap-0.5"
        >
          {SIDEBAR_SKELETON_WIDTHS.map((width, index) => (
            <div key={index} className="flex h-8 items-center px-2">
              <Skeleton className={cn("h-3.5", width)} />
            </div>
          ))}
        </div>
      ) : showLoadError ? (
        <div
          role="alert"
          className="mt-1 flex h-8 shrink-0 items-center justify-between px-2 text-[13px]"
        >
          <span className="text-muted-foreground">לא ניתן לטעון את השיחות</span>
          <button
            type="button"
            onClick={() => void aui.threads.reload()}
            className="text-muted-foreground hover:text-foreground rounded-control -me-2 h-8 px-2 transition-colors"
          >
            נסה שוב
          </button>
        </div>
      ) : (
        <>
          <p className={sidebarLabelClass}>שיחות</p>
          <div className="flex flex-col gap-0.5">
            <ThreadListPrimitive.Items components={threadListItemComponents} />
          </div>
        </>
      )}
      <ThreadListPrimitive.LoadMore asChild>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground rounded-control mt-1 flex h-8 shrink-0 items-center px-2 text-[13px] transition-colors disabled:hidden"
        >
          טען עוד
        </button>
      </ThreadListPrimitive.LoadMore>
      {hasArchived ? <ArchivedThreads /> : null}
    </>
  );
}

function ArchivedThreads(): ReactNode {
  const [open, setOpen] = useState(false);
  const count = useAuiState((s) => s.threads.archivedThreadIds.length);

  return (
    <div className="mt-5">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className={cn(
          sidebarLabelClass,
          "hover:text-foreground mt-0 flex w-full items-center gap-1 transition-colors",
        )}
      >
        <ChevronDownIcon
          className={cn(
            "size-3 transition-transform",
            !open && "rtl:rotate-90 ltr:-rotate-90",
          )}
        />
        בארכיון ({count})
      </button>
      {open ? (
        <div className="flex flex-col gap-0.5">
          <ThreadListPrimitive.Items
            archived
            components={threadListItemComponents}
          />
        </div>
      ) : null}
    </div>
  );
}
