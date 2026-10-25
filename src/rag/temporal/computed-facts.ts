import { calendarDaysBetween } from "./calendar";
import { extractDatedEvents } from "./extract-dated-events";
import type {
  ComputedTemporalFacts,
  DatedEvent,
  DatedEventKind,
  TemporalDaySpan,
} from "./types";

const SPAN_PAIRS: Array<[DatedEventKind, DatedEventKind]> = [
  ["purchase", "cancellation"],
  ["insurance_start", "cancellation"],
  ["issue", "cancellation"],
];

/**
 * Build computed temporal facts from user-authored texts only.
 * Assistant turns must not be passed in.
 */
export function buildComputedTemporalFacts(
  userTexts: readonly string[],
): ComputedTemporalFacts {
  const joined = userTexts.filter(Boolean).join("\n");
  const { events, unsupportedNotes } = extractDatedEvents(joined);
  const byKind = new Map<DatedEventKind, DatedEvent>();
  for (const ev of events) byKind.set(ev.kind, ev);

  const daySpans: TemporalDaySpan[] = [];
  for (const [fromKind, toKind] of SPAN_PAIRS) {
    const from = byKind.get(fromKind);
    const to = byKind.get(toKind);
    if (!from || !to) continue;
    const calendarDays = calendarDaysBetween(from.isoDate, to.isoDate);
    daySpans.push({
      fromKind,
      toKind,
      fromIso: from.isoDate,
      toIso: to.isoDate,
      calendarDays,
      orderOk: calendarDays >= 0,
    });
  }

  const missingOrUncertain: string[] = [];

  // Purchase missing while user timed from insurance start (relative or absolute).
  const mentionsInsuranceStartClock =
    /תחילת\s*הביטוח|תחילת\s*הכיסוי/.test(joined);
  const hasPurchase = byKind.has("purchase");
  if (mentionsInsuranceStartClock && !hasPurchase) {
    missingOrUncertain.push(
      "purchase date not provided; source cancellation windows that count from purchase cannot be decided from insurance_start alone (do not assume purchase = insurance_start).",
    );
  }

  for (const span of daySpans) {
    if (!span.orderOk) {
      missingOrUncertain.push(
        `${span.toKind} date ${span.toIso} is before ${span.fromKind} date ${span.fromIso}; day order is reversed — do not treat as a normal forward eligibility window.`,
      );
    }
  }

  for (const note of unsupportedNotes) {
    if (note.startsWith("Ambiguous")) {
      missingOrUncertain.push(note);
    }
  }

  return {
    events,
    daySpans,
    missingOrUncertain,
    unsupportedNotes,
  };
}

/**
 * Prompt lines for Generation. Not a corpus source; not citable as a document.
 * Contains no eligibility thresholds, fee rates, or canned answers.
 */
export function formatComputedTemporalFactsForPrompt(
  facts: ComputedTemporalFacts,
): string[] {
  const hasContent =
    facts.events.length > 0 ||
    facts.daySpans.length > 0 ||
    facts.missingOrUncertain.length > 0;
  if (!hasContent) return [];

  const lines: string[] = [
    "Computed temporal facts (from user text only — NOT a corpus source; do not cite as a document chunk):",
  ];

  for (const ev of facts.events) {
    lines.push(
      `- Event ${ev.kind}: ${ev.isoDate} (user quote: "${ev.quote}")`,
    );
  }

  for (const span of facts.daySpans) {
    lines.push(
      `- Calendar days from ${span.fromKind} (${span.fromIso}) to ${span.toKind} (${span.toIso}): ${span.calendarDays}` +
        (span.orderOk ? "" : " [reversed order]"),
    );
  }

  for (const miss of facts.missingOrUncertain) {
    lines.push(`- Missing/uncertain: ${miss}`);
  }

  lines.push(
    "Use these calendar day counts when applying period windows stated in Context sources.",
    "Eligibility conditions, day thresholds, fee percentages, and caps still come only from Context sources.",
    "If a listed missing clock is required for the user's case, say so; do not invent dates or equate distinct event kinds.",
  );

  return lines;
}

/** Collect user-role texts for extraction (excludes assistant). */
export function userTextsForTemporalExtraction(input: {
  question: string;
  history?: readonly { role: string; content: string }[];
}): string[] {
  const prior = (input.history ?? [])
    .filter((m) => m.role === "user")
    .map((m) => m.content);
  return [...prior, input.question];
}
