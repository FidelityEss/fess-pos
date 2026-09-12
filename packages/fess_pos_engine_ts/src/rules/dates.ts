/**
 * Calendar arithmetic on ISO dates with pure integer algorithms (H. Hinnant's days-from-civil),
 * so the Dart engine can reproduce results exactly. No time zones, no wall clock.
 */
import { RuleError } from "../errors.ts";
import type { DateUnit } from "./spec.ts";

export interface CivilDate {
  readonly y: number;
  readonly m: number;
  readonly d: number;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d{1,9})?)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$/;

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  if (m === 2) return isLeapYear(y) ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

/** Parse `YYYY-MM-DD`, or the date part of an ISO datetime with offset. Null when malformed. */
export function tryParseDate(s: string): CivilDate | null {
  const m = DATE_RE.exec(s) ?? DATETIME_RE.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
  return { y, m: mo, d };
}

export function isIsoDate(s: string): boolean {
  return DATE_RE.test(s) && tryParseDate(s) !== null;
}

export function isIsoDateTime(s: string): boolean {
  return DATETIME_RE.test(s) && tryParseDate(s) !== null;
}

export function parseDate(s: string, op: string): CivilDate {
  const d = tryParseDate(s);
  if (!d) throw new RuleError("RULE_INVALID_DATE", `${op}: "${s}" is not an ISO date`);
  return d;
}

export function daysFromCivil({ y: y0, m, d }: CivilDate): number {
  const y = m <= 2 ? y0 - 1 : y0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = (m + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

export function civilFromDays(z0: number): CivilDate {
  const z = z0 + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return { y: m <= 2 ? y + 1 : y, m, d };
}

export function formatDate({ y, m, d }: CivilDate): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function compareCivil(a: CivilDate, b: CivilDate): number {
  return a.y !== b.y ? a.y - b.y : a.m !== b.m ? a.m - b.m : a.d - b.d;
}

function monthsBetween(a: CivilDate, b: CivilDate): number {
  if (compareCivil(b, a) < 0) return -monthsBetween(b, a);
  let months = (b.y - a.y) * 12 + (b.m - a.m);
  if (b.d < a.d) months -= 1;
  return months;
}

/** Whole units from `a` to `b` (negative when b is earlier). */
export function dateDiff(a: CivilDate, b: CivilDate, unit: DateUnit): number {
  switch (unit) {
    case "days":
      return daysFromCivil(b) - daysFromCivil(a);
    case "months":
      return monthsBetween(a, b);
    case "years": {
      const years = Math.trunc(monthsBetween(a, b) / 12);
      return years === 0 ? 0 : years;
    }
  }
}

/** Add whole units; month/year arithmetic clamps the day to the end of the target month. */
export function dateAdd(a: CivilDate, amount: number, unit: DateUnit): CivilDate {
  let out: CivilDate;
  if (unit === "days") {
    out = civilFromDays(daysFromCivil(a) + amount);
  } else {
    const months = unit === "months" ? amount : amount * 12;
    const total = a.y * 12 + (a.m - 1) + months;
    const y = Math.floor(total / 12);
    const m = total - y * 12 + 1;
    out = { y, m, d: Math.min(a.d, daysInMonth(y, m)) };
  }
  if (out.y < 0 || out.y > 9999) throw new RuleError("RULE_INVALID_DATE", "date_add: result outside years 0000–9999");
  return out;
}
