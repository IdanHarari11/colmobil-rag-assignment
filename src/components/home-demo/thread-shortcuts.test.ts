import { describe, expect, it } from "vitest";
import {
  formatThreadShortcut,
  getThreadCommands,
  getThreadShortcut,
} from "./thread-shortcuts";

function keyEvent(
  partial: Partial<KeyboardEvent> & Pick<KeyboardEvent, "code" | "key">,
): KeyboardEvent {
  return {
    defaultPrevented: false,
    isComposing: false,
    repeat: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    ...partial,
  } as KeyboardEvent;
}

describe("getThreadShortcut", () => {
  it("matches Alt+Shift letter chords (Windows/Linux)", () => {
    expect(
      getThreadShortcut(
        keyEvent({ code: "KeyO", key: "O", altKey: true, shiftKey: true }),
      ),
    ).toBe("new");
  });

  it("matches Cmd+Shift letter chords (Mac)", () => {
    expect(
      getThreadShortcut(
        keyEvent({ code: "KeyO", key: "o", metaKey: true, shiftKey: true }),
      ),
    ).toBe("new");
    expect(
      getThreadShortcut(
        keyEvent({ code: "KeyC", key: "c", metaKey: true, shiftKey: true }),
      ),
    ).toBe("composer");
  });

  it("matches Alt/Option arrow navigation", () => {
    expect(
      getThreadShortcut(
        keyEvent({ code: "ArrowUp", key: "ArrowUp", altKey: true }),
      ),
    ).toBe("previous");
  });

  it("does not steal Cmd+Arrow (text editing on Mac)", () => {
    expect(
      getThreadShortcut(
        keyEvent({ code: "ArrowUp", key: "ArrowUp", metaKey: true }),
      ),
    ).toBeUndefined();
  });

  it("ignores Ctrl chords", () => {
    expect(
      getThreadShortcut(
        keyEvent({
          code: "KeyO",
          key: "O",
          altKey: true,
          shiftKey: true,
          ctrlKey: true,
        }),
      ),
    ).toBeUndefined();
  });
});

describe("shortcut labels", () => {
  it("shows Cmd on Apple and Alt elsewhere for primary chords", () => {
    expect(
      formatThreadShortcut({ keys: ["⇧", "O"], modifier: "primary" }, true),
    ).toBe("⌘ ⇧ O");
    expect(
      formatThreadShortcut({ keys: ["⇧", "O"], modifier: "primary" }, false),
    ).toBe("Alt ⇧ O");
  });

  it("shows Option on Apple for arrow chords", () => {
    expect(
      formatThreadShortcut({ keys: ["↑"], modifier: "alt" }, true),
    ).toBe("⌥ ↑");
    expect(getThreadCommands(true)[0]?.shortcut).toBe("⌘ ⇧ O");
  });
});
