import type { ParsedUserDate, UserDateKind, UserTemporalFacts } from "./types";

const HEBREW_MONTHS: Record<string, string> = {
  ינואר: "01",
  פברואר: "02",
  מרץ: "03",
  אפריל: "04",
  מאי: "05",
  יוני: "06",
  יולי: "07",
  אוגוסט: "08",
  ספטמבר: "09",
  אוקטובר: "10",
  נובמבר: "11",
  דצמבר: "12",
};

/**
 * Extract explicit issue / renewal / event dates from user wording.
 * Does not invent dates; does not treat event dates as issue/renewal.
 */
export function extractUserTemporalFacts(
  texts: readonly string[],
): UserTemporalFacts {
  const joined = texts.filter(Boolean).join("\n");
  const facts: UserTemporalFacts = { dateKindsUsed: [] };

  const issue = findDateNear(
    joined,
    /(הונפק[הו]?|הנפק[הת]?|נרכש[ה]?|נפתח[ה]?)\s*[^\n]{0,40}/gi,
    "issue",
  );
  const renewal = findDateNear(
    joined,
    /(חודש[ה]?|חידוש|חודשה|חודשתי)\s*[^\n]{0,40}/gi,
    "renewal",
  );
  const event = findDateNear(
    joined,
    /(תאונ[הת]|אירוע|אירע[ה]?|נזק|תביע[ה])\s*[^\n]{0,48}/gi,
    "event",
  );

  // Explicit "policy from DATE" / "פוליסה מ-DATE" without event wording → issue.
  if (!issue) {
    const policyFrom = findDateNear(
      joined,
      /(פוליס[הת]|מקיף|ביטוח)\s*[^\n]{0,30}?(מ[-–]?|מיום|מתאריך)\s*/gi,
      "issue",
    );
    if (policyFrom) facts.issue = policyFrom;
  } else {
    facts.issue = issue;
  }
  if (renewal) facts.renewal = renewal;
  if (event) facts.event = event;

  // Standalone absolute dates with issue verbs already handled.
  // If text has "שהונפקה באפריל 2026" style month+year:
  if (!facts.issue) {
    const monthIssue = findMonthYearNearIssue(joined);
    if (monthIssue) facts.issue = monthIssue;
  }

  for (const kind of ["issue", "renewal", "event"] as const) {
    if (facts[kind]) facts.dateKindsUsed.push(kind);
  }
  return facts;
}

function findDateNear(
  text: string,
  trigger: RegExp,
  kind: UserDateKind,
): ParsedUserDate | undefined {
  for (const match of text.matchAll(trigger)) {
    const window = text.slice(
      match.index ?? 0,
      (match.index ?? 0) + match[0].length + 24,
    );
    const parsed = parseDateInText(window);
    if (parsed) {
      return { ...parsed, kind, kindExplicit: true };
    }
  }
  return undefined;
}

function findMonthYearNearIssue(text: string): ParsedUserDate | undefined {
  const re =
    /(הונפק[הו]?|הנפק[הת]?|פוליס[הת][^\n]{0,20})\s*[^\n]{0,20}?(ב)?(ינואר|פברואר|מרץ|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר)\s+(\d{4})/gi;
  const m = re.exec(text);
  if (!m) return undefined;
  const month = HEBREW_MONTHS[m[3] ?? ""];
  const year = m[4];
  if (!month || !year) return undefined;
  return {
    kind: "issue",
    yearMonth: `${year}-${month}`,
    kindExplicit: true,
  };
}

function parseDateInText(text: string): Omit<ParsedUserDate, "kind" | "kindExplicit"> | undefined {
  const dmy = text.match(/(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (dmy) {
    const day = dmy[1]!.padStart(2, "0");
    const month = dmy[2]!.padStart(2, "0");
    const year = dmy[3]!;
    return { isoDate: `${year}-${month}-${day}` };
  }
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return { isoDate: `${iso[1]}-${iso[2]}-${iso[3]}` };
  }
  const monthYear = text.match(
    /(ינואר|פברואר|מרץ|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר)\s+(\d{4})/,
  );
  if (monthYear) {
    const month = HEBREW_MONTHS[monthYear[1] ?? ""];
    if (month) return { yearMonth: `${monthYear[2]}-${month}` };
  }
  return undefined;
}

/** Compare user date to an ISO threshold. Month-only uses inclusive month bounds carefully. */
export function isOnOrAfter(
  user: ParsedUserDate,
  thresholdIso: string,
): boolean | undefined {
  if (user.isoDate) return user.isoDate >= thresholdIso;
  if (user.yearMonth) {
    const thresholdYm = thresholdIso.slice(0, 7);
    if (user.yearMonth > thresholdYm) return true;
    if (user.yearMonth < thresholdYm) return false;
    // Same month as threshold day: cannot know if day is on/after without day precision.
    return undefined;
  }
  return undefined;
}

export function isBefore(
  user: ParsedUserDate,
  exclusiveEndIso: string,
): boolean | undefined {
  if (user.isoDate) return user.isoDate < exclusiveEndIso;
  if (user.yearMonth) {
    const endYm = exclusiveEndIso.slice(0, 7);
    if (user.yearMonth < endYm) return true;
    if (user.yearMonth > endYm) return false;
    return undefined;
  }
  return undefined;
}

/** Prefer renewal over issue when both exist for transition rules (renewal can move a policy). */
export function governingPolicyDate(
  facts: UserTemporalFacts,
): { date: ParsedUserDate; kind: UserDateKind } | undefined {
  if (facts.renewal) return { date: facts.renewal, kind: "renewal" };
  if (facts.issue) return { date: facts.issue, kind: "issue" };
  return undefined;
}
