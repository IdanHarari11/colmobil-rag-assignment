/**
 * Structured dated events extracted from user wording only.
 * Not corpus metadata; not used for document citations.
 */

export type DatedEventKind =
  | "purchase"
  | "insurance_start"
  | "cancellation"
  | "issue"
  | "renewal";

export interface DatedEvent {
  kind: DatedEventKind;
  /** Normalized YYYY-MM-DD when day precision is known and valid. */
  isoDate: string;
  /** Short quote from user text supporting the binding. */
  quote: string;
  /** 0-based character offset of the quote in the joined user texts. */
  startOffset: number;
  endOffset: number;
}

export interface TemporalDaySpan {
  fromKind: DatedEventKind;
  toKind: DatedEventKind;
  fromIso: string;
  toIso: string;
  /** to − from in whole calendar days (may be negative if reversed). */
  calendarDays: number;
  orderOk: boolean;
}

export interface ComputedTemporalFacts {
  events: DatedEvent[];
  daySpans: TemporalDaySpan[];
  /** Human-readable missing / uncertain clocks (English, for the model block). */
  missingOrUncertain: string[];
  /** Unsupported / skipped patterns (English; tracing). */
  unsupportedNotes: string[];
}
