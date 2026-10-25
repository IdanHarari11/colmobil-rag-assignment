/**
 * Timezone-stable calendar date helpers (UTC midnight arithmetic).
 * Day differences are not affected by server local TZ or DST.
 */

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True when YYYY-MM-DD is a real Gregorian calendar day. */
export function isValidIsoDate(iso: string): boolean {
  const m = ISO_DATE_RE.exec(iso.trim());
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const utc = Date.UTC(year, month - 1, day);
  const dt = new Date(utc);
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

/**
 * Parse day/month/year or ISO fragments into YYYY-MM-DD when valid.
 * Unsupported: Hebrew month names alone, relative phrases, times of day.
 */
export function parseExplicitIsoDate(text: string): string | undefined {
  const dmy = text.match(/(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (dmy) {
    const day = dmy[1]!.padStart(2, "0");
    const month = dmy[2]!.padStart(2, "0");
    const year = dmy[3]!;
    const iso = `${year}-${month}-${day}`;
    return isValidIsoDate(iso) ? iso : undefined;
  }
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const candidate = `${iso[1]}-${iso[2]}-${iso[3]}`;
    return isValidIsoDate(candidate) ? candidate : undefined;
  }
  return undefined;
}

/**
 * Whole calendar days from `fromIso` to `toIso` (to − from).
 * Example: 2026-01-01 → 2026-01-20 = 19.
 * Negative when `to` is before `from`.
 */
export function calendarDaysBetween(fromIso: string, toIso: string): number {
  if (!isValidIsoDate(fromIso) || !isValidIsoDate(toIso)) {
    throw new Error(`Invalid ISO date for day difference: ${fromIso} → ${toIso}`);
  }
  const [y1, m1, d1] = fromIso.split("-").map(Number) as [number, number, number];
  const [y2, m2, d2] = toIso.split("-").map(Number) as [number, number, number];
  const t1 = Date.UTC(y1, m1 - 1, d1);
  const t2 = Date.UTC(y2, m2 - 1, d2);
  return Math.round((t2 - t1) / 86_400_000);
}
