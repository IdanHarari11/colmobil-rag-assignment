import { describe, expect, it } from "vitest";
import {
  calendarDaysBetween,
  isValidIsoDate,
  parseExplicitIsoDate,
} from "./calendar";

describe("calendarDaysBetween", () => {
  it("counts 1.1.2026 → 20.1.2026 as 19 calendar days", () => {
    expect(calendarDaysBetween("2026-01-01", "2026-01-20")).toBe(19);
  });

  it("handles month boundary", () => {
    expect(calendarDaysBetween("2026-01-25", "2026-02-05")).toBe(11);
  });

  it("handles year boundary", () => {
    expect(calendarDaysBetween("2025-12-28", "2026-01-03")).toBe(6);
  });

  it("returns 0 for same day", () => {
    expect(calendarDaysBetween("2026-01-01", "2026-01-01")).toBe(0);
  });

  it("returns negative when order is reversed", () => {
    expect(calendarDaysBetween("2026-01-20", "2026-01-01")).toBe(-19);
  });
});

describe("isValidIsoDate / parseExplicitIsoDate", () => {
  it("rejects invalid calendar days", () => {
    expect(isValidIsoDate("2026-02-30")).toBe(false);
    expect(parseExplicitIsoDate("30.2.2026")).toBeUndefined();
    expect(parseExplicitIsoDate("32.1.2026")).toBeUndefined();
  });

  it("parses D.M.YYYY and ISO", () => {
    expect(parseExplicitIsoDate("ב-1.1.2026")).toBe("2026-01-01");
    expect(parseExplicitIsoDate("2026-01-10")).toBe("2026-01-10");
  });
});
