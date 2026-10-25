import { parseExplicitIsoDate } from "./calendar";
import type { DatedEvent, DatedEventKind } from "./types";

/**
 * Safe label → kind bindings. Intentionally narrow.
 *
 * Supported date formats: D.M.YYYY, D/M/YYYY, YYYY-MM-DD (validated).
 * Unsupported (documented): Hebrew month+year only, relative-only intervals
 * without an absolute date ("עשרה ימים אחרי…"), times of day, English month
 * names, multi-scenario "if … if …" forks with conflicting same-kind dates
 * (those become uncertain rather than certain facts).
 */

interface LabelPattern {
  kind: DatedEventKind;
  /** Must match near a date; capture groups unused. */
  re: RegExp;
}

const LABEL_PATTERNS: LabelPattern[] = [
  {
    kind: "purchase",
    re: /(?:מועד\s*הרכישה|תאריך\s*הרכישה|רכישת\s*הפוליסה|הרכישה\s*הייתה|נרכש[ה]?)\s*[^\n.]{0,40}/gi,
  },
  {
    kind: "insurance_start",
    re: /(?:תחילת\s*הביטוח|תחילת\s*הכיסוי|מועד\s*תחילת\s*הביטוח)\s*[^\n.]{0,40}/gi,
  },
  {
    kind: "cancellation",
    re: /(?:ואני\s*מבטל|אני\s*מבטל|מבטל(?:ת)?\s*(?:את\s*)?הפוליסה|ביטול(?:\s*הפוליסה)?)\s*[^\n.]{0,48}/gi,
  },
  {
    kind: "issue",
    re: /(?:הונפק[הו]?|הנפק[הת]?)\s*[^\n.]{0,40}/gi,
  },
  {
    kind: "renewal",
    re: /(?:חודש[התי]?|חידוש)\s*[^\n.]{0,40}/gi,
  },
];

/**
 * Extract labeled absolute dates from joined user texts.
 * Does not equate purchase with issue or insurance_start.
 */
export function extractDatedEvents(userText: string): {
  events: DatedEvent[];
  unsupportedNotes: string[];
} {
  const unsupportedNotes: string[] = [];
  const candidates: DatedEvent[] = [];

  if (!userText.trim()) {
    return { events: [], unsupportedNotes };
  }

  for (const { kind, re } of LABEL_PATTERNS) {
    re.lastIndex = 0;
    for (const match of userText.matchAll(re)) {
      const start = match.index ?? 0;
      // Look for a date in the match window and a short tail after it.
      const windowEnd = Math.min(userText.length, start + match[0].length + 28);
      const window = userText.slice(start, windowEnd);
      const iso = parseExplicitIsoDate(window);
      if (!iso) {
        // Label without a safe absolute date in window — skip (relative phrases stay unsupported).
        continue;
      }
      const dateMatch = window.match(
        /(\d{1,2}[./]\d{1,2}[./]\d{4}|\d{4}-\d{2}-\d{2})/,
      );
      const dateStartInWindow = dateMatch ? window.indexOf(dateMatch[0]!) : 0;
      const absDateStart = start + dateStartInWindow;
      const absDateEnd = absDateStart + (dateMatch?.[0]?.length ?? 0);
      const quote = userText
        .slice(start, Math.min(userText.length, Math.max(absDateEnd, start + match[0].length)))
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 120);
      candidates.push({
        kind,
        isoDate: iso,
        quote,
        startOffset: start,
        endOffset: absDateEnd,
      });
    }
  }

  // Same kind with conflicting dates → uncertain (drop that kind).
  const byKind = new Map<DatedEventKind, DatedEvent[]>();
  for (const ev of candidates) {
    const list = byKind.get(ev.kind) ?? [];
    list.push(ev);
    byKind.set(ev.kind, list);
  }

  const events: DatedEvent[] = [];
  for (const [kind, list] of byKind) {
    const uniqueDates = [...new Set(list.map((e) => e.isoDate))];
    if (uniqueDates.length > 1) {
      unsupportedNotes.push(
        `Ambiguous ${kind}: multiple distinct dates (${uniqueDates.join(", ")}); not emitted as a certain fact.`,
      );
      continue;
    }
    // Prefer the earliest mention for quote stability.
    const sorted = [...list].sort((a, b) => a.startOffset - b.startOffset);
    events.push(sorted[0]!);
  }

  // Detect relative "N days after insurance start" without absolute purchase.
  if (
    /(?:אחרי|לאחר)\s+תחילת\s+הביטוח/.test(userText) &&
    !events.some((e) => e.kind === "purchase")
  ) {
    unsupportedNotes.push(
      "Relative interval from insurance_start mentioned without an absolute purchase date.",
    );
  }

  return { events, unsupportedNotes };
}
