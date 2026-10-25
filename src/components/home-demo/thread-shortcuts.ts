import { useSyncExternalStore } from "react";

export type ThreadCommand =
  | "new"
  | "previous"
  | "next"
  | "rename"
  | "archive"
  | "pin"
  | "sidebar"
  | "composer";

type ThreadCommandDef = {
  id: ThreadCommand;
  label: string;
  /** Keys after the platform modifier, e.g. ["⇧", "O"] or ["↑"]. */
  keys: readonly string[];
  /** Use Option/Alt for arrows so Cmd+Arrow stays available for text editing. */
  modifier: "primary" | "alt";
};

const THREAD_COMMAND_DEFS: readonly ThreadCommandDef[] = [
  { id: "new", label: "שיחה חדשה", keys: ["⇧", "O"], modifier: "primary" },
  { id: "previous", label: "שיחה קודמת", keys: ["↑"], modifier: "alt" },
  { id: "next", label: "שיחה הבאה", keys: ["↓"], modifier: "alt" },
  { id: "rename", label: "שינוי שם", keys: ["⇧", "R"], modifier: "primary" },
  {
    id: "archive",
    label: "ארכוב / שחזור",
    keys: ["⇧", "X"],
    modifier: "primary",
  },
  {
    id: "pin",
    label: "נעיצה / ביטול נעיצה",
    keys: ["⇧", "P"],
    modifier: "primary",
  },
  {
    id: "sidebar",
    label: "הצגת / הסתרת היסטוריה",
    keys: ["⇧", "H"],
    modifier: "primary",
  },
  {
    id: "composer",
    label: "מיקוד בשדה ההודעה",
    keys: ["⇧", "C"],
    modifier: "primary",
  },
];

/** True on Apple devices where Cmd (⌘) is the expected app modifier. */
export function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /Mac|iPhone|iPad|iPod/i.test(navigator.platform) ||
    /Mac OS X|iPhone|iPad|iPod/i.test(navigator.userAgent)
  );
}

/** Hydration-safe Apple platform detection for shortcut labels. */
export function useIsApplePlatform(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => isApplePlatform(),
    () => false,
  );
}

export function getCommandShortcutLabels(
  id: ThreadCommand,
  apple = isApplePlatform(),
): { display: string; aria: string } {
  const def = THREAD_COMMAND_DEFS.find((command) => command.id === id);
  if (!def) throw new Error(`Unknown thread command: ${id}`);
  return {
    display: formatThreadShortcut(def, apple),
    aria: ariaThreadShortcut(def, apple),
  };
}

function primaryModifierLabel(apple: boolean): string {
  return apple ? "⌘" : "Alt";
}

function altModifierLabel(apple: boolean): string {
  return apple ? "⌥" : "Alt";
}

export function formatThreadShortcut(
  def: Pick<ThreadCommandDef, "keys" | "modifier">,
  apple = isApplePlatform(),
): string {
  const mod =
    def.modifier === "primary"
      ? primaryModifierLabel(apple)
      : altModifierLabel(apple);
  return [mod, ...def.keys].join(" ");
}

/** Accessible keyshortcuts token (ARIA), e.g. "Meta+Shift+O" / "Alt+Shift+O". */
export function ariaThreadShortcut(
  def: Pick<ThreadCommandDef, "keys" | "modifier">,
  apple = isApplePlatform(),
): string {
  const mod =
    def.modifier === "primary"
      ? apple
        ? "Meta"
        : "Alt"
      : "Alt";
  const parts = def.keys.map((key) => {
    if (key === "⇧") return "Shift";
    if (key === "↑") return "ArrowUp";
    if (key === "↓") return "ArrowDown";
    return key;
  });
  return [mod, ...parts].join("+");
}

export function getThreadCommands(apple = isApplePlatform()) {
  return THREAD_COMMAND_DEFS.map((def) => ({
    id: def.id,
    label: def.label,
    shortcut: formatThreadShortcut(def, apple),
  }));
}

/** Static list for typing; prefer getThreadCommands() for display labels. */
export const threadCommands = getThreadCommands(false);

const SHIFT_LETTER_COMMANDS: Record<string, ThreadCommand> = {
  KeyO: "new",
  KeyR: "rename",
  KeyX: "archive",
  KeyH: "sidebar",
  KeyP: "pin",
  KeyC: "composer",
};

/**
 * Matches thread shortcuts on Windows/Linux (Alt) and Mac (⌘ or ⌥).
 * Letter chords accept Cmd or Alt; arrow navigation stays on Alt/Option.
 */
export function getThreadShortcut(
  event: KeyboardEvent,
): ThreadCommand | undefined {
  if (event.defaultPrevented || event.isComposing || event.repeat) return;
  if (event.ctrlKey) return;

  if (
    event.shiftKey &&
    (event.metaKey || event.altKey) &&
    !(event.metaKey && event.altKey)
  ) {
    return SHIFT_LETTER_COMMANDS[event.code];
  }

  if (event.altKey && !event.metaKey && !event.shiftKey) {
    if (event.key === "ArrowUp") return "previous";
    if (event.key === "ArrowDown") return "next";
  }

  return undefined;
}
