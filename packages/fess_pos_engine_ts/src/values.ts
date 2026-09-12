/**
 * Value-shape validation per component type (docs/11 value shapes). Used by the validator on every
 * visible, non-empty answer. `props` are the *resolved* props (rule-able props already evaluated).
 */
import type { JsonObject, JsonValue } from "./json.ts";
import { isPlainObject, readPath } from "./json.ts";
import { DATETIME_RE, TIME_RE, UUID_RE } from "./definitions/schemas.ts";
import { daysInMonth, isIsoDate, isIsoDateTime, tryParseDate } from "./rules/dates.ts";
import { haversineM, toPoint } from "./rules/math.ts";
import { compileSafeRegex } from "./rules/regex.ts";
import { RuleError } from "./errors.ts";

export interface ValueIssue {
  readonly code: string;
  readonly message: string;
}

export interface ValueEnv {
  readonly job?: JsonValue;
  readonly today?: string | null;
}

export const VALUE_ERROR_CODES = [
  "INVALID_TYPE",
  "INVALID_FORMAT",
  "INVALID_CHECKSUM",
  "TOO_SHORT",
  "TOO_LONG",
  "PATTERN_MISMATCH",
  "BELOW_MIN",
  "ABOVE_MAX",
  "OUT_OF_RANGE",
  "NOT_INTEGER",
  "TOO_MANY_DECIMALS",
  "INVALID_STEP",
  "CURRENCY_MISMATCH",
  "DUPLICATE_VALUE",
  "TOO_FEW",
  "TOO_MANY",
  "EXCLUSIVE_OPTION_COMBINED",
  "INVALID_UNIT",
  "MISSING_GROUP",
  "INVALID_HOURS",
  "PIN_REQUIRED",
  "PIN_NOT_ALLOWED",
  "INVALID_OPTION",
  "TOO_FAR",
  "ACCURACY_TOO_LOW",
  "NOT_ACCEPTED",
  "MISSING_ROW",
  "UNKNOWN_ROW",
] as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const E164_RE = /^\+[1-9]\d{6,14}$/;
const PASSPORT_RE = /^[A-Z0-9]{6,20}$/;
const CIPC_RE = /^\d{4}\/\d{6}\/\d{2}$/;
const VAT_ZA_RE = /^4\d{9}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;
const PIN_SOURCES = ["map_pin", "current_location", "geocoded", "job"];
const HOUR_GROUPS = ["weekdays", "saturday", "sunday", "public_holidays"];
const DURATION_UNITS = ["days", "months", "years"];

/** Empty answers: null, "", [] and {} (e.g. an untouched address). */
export function isEmptyAnswer(v: JsonValue | undefined): boolean {
  if (v === undefined || v === null || v === "") return true;
  if (Array.isArray(v)) return v.length === 0;
  return isPlainObject(v) && Object.keys(v).length === 0;
}

/** Decimal places of a number as serialised by ECMAScript (e.g. 1.25 → 2, 1e-7 → 7). */
export function decimalPlaces(n: number): number {
  const m = /^(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/.exec(String(Math.abs(n)));
  if (!m) return 0;
  const frac = m[2]?.length ?? 0;
  const exp = m[3] ? Number(m[3]) : 0;
  return Math.max(0, frac - exp);
}

function codePoints(s: string): number {
  return [...s].length;
}

/** South African ID number: 13 digits, valid YYMMDD, Luhn check digit. */
export function isValidZaId(id: string): boolean {
  if (!/^\d{13}$/.test(id)) return false;
  const mm = Number(id.slice(2, 4));
  const dd = Number(id.slice(4, 6));
  if (mm < 1 || mm > 12 || dd < 1 || dd > daysInMonth(2000, mm)) return false;
  let sum = 0;
  for (let i = 0; i < 13; i++) {
    let d = Number(id[12 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/**
 * Derived facts exposed to rules as `derived.<field_key>` for za_id numbers:
 * `dob` (YYYY-MM-DD; century chosen so the date is not after `today`) and `gender` (digits 7–10 < 5000 → female).
 * Null without a frozen `today`, because the century cannot be decided deterministically.
 */
export function zaIdDerived(id: string, today: string | null | undefined): JsonObject | null {
  if (!isValidZaId(id) || typeof today !== "string" || !isIsoDate(today)) return null;
  const yy = Number(id.slice(0, 2));
  const mm = Number(id.slice(2, 4));
  const dd = Number(id.slice(4, 6));
  const t = tryParseDate(today);
  /* c8 ignore next */
  if (!t) return null;
  let year = 2000 + yy;
  const birthAfterToday = year > t.y || (year === t.y && (mm > t.m || (mm === t.m && dd > t.d)));
  if (birthAfterToday) year -= 100;
  if (dd > daysInMonth(year, mm)) return null;
  const dob = `${String(year).padStart(4, "0")}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  return { dob, gender: Number(id.slice(6, 10)) < 5000 ? "female" : "male" };
}

function strictKeys(o: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(o).every((k) => allowed.includes(k));
}

const num = (v: JsonValue | undefined): number | null => (typeof v === "number" ? v : null);
const str = (v: JsonValue | undefined): string | null => (typeof v === "string" ? v : null);

function isPoint(v: JsonValue | undefined, extraKeys: readonly string[]): boolean {
  if (!isPlainObject(v)) return false;
  if (!strictKeys(v, ["lat", "lng", ...extraKeys])) return false;
  try {
    return toPoint(v as JsonObject, "value") !== null;
  } catch {
    return false;
  }
}

/** Validate one non-empty answer value against its component type. */
export function validateValue(type: string, value: JsonValue, props: JsonObject, env: ValueEnv = {}): ValueIssue[] {
  const out: ValueIssue[] = [];
  const push = (code: string, message: string): void => {
    out.push({ code, message });
  };
  const bad = (want: string): ValueIssue[] => {
    push("INVALID_TYPE", `expected ${want}`);
    return out;
  };
  const range = (n: number, min: JsonValue | undefined, max: JsonValue | undefined): void => {
    const lo = num(min);
    const hi = num(max);
    if (lo !== null && n < lo) push("BELOW_MIN", `must be at least ${lo}`);
    if (hi !== null && n > hi) push("ABOVE_MAX", `must be at most ${hi}`);
  };
  const pattern = (s: string): void => {
    const p = str(props["pattern"]);
    if (p === null) return;
    try {
      if (!compileSafeRegex(p).test(s)) push("PATTERN_MISMATCH", "does not match the required format");
    } catch (e) {
      /* c8 ignore next — patterns are checked at publish */
      push("PATTERN_MISMATCH", e instanceof RuleError ? e.message : "invalid pattern");
    }
  };

  switch (type) {
    case "text":
    case "textarea": {
      if (typeof value !== "string") return bad("a string");
      const n = codePoints(value);
      const min = num(props["min_length"]);
      const max = num(props["max_length"]);
      if (min !== null && n < min) push("TOO_SHORT", `must be at least ${min} characters`);
      if (max !== null && n > max) push("TOO_LONG", `must be at most ${max} characters`);
      pattern(value);
      return out;
    }
    case "email":
      if (typeof value !== "string") return bad("a string");
      if (value.length > 254 || !EMAIL_RE.test(value)) push("INVALID_FORMAT", "not a valid email address");
      return out;
    case "phone":
      if (typeof value !== "string") return bad("an E.164 phone number string");
      if (!E164_RE.test(value)) push("INVALID_FORMAT", "not an E.164 phone number (e.g. +27821234567)");
      return out;
    case "number":
    case "percentage":
    case "slider": {
      if (typeof value !== "number" || !Number.isFinite(value)) return bad("a number");
      if (type === "percentage" && (value < 0 || value > 100)) push("OUT_OF_RANGE", "must be between 0 and 100");
      if (type === "number" && props["integer"] === true && !Number.isInteger(value)) push("NOT_INTEGER", "must be a whole number");
      const d = num(props["decimals"]);
      if (d !== null && decimalPlaces(value) > d) push("TOO_MANY_DECIMALS", `at most ${d} decimal places`);
      range(value, props["min"], props["max"]);
      const step = num(props["step"]);
      if (type === "slider" && step !== null && step > 0) {
        const q = (value - (num(props["min"]) ?? 0)) / step;
        if (Math.abs(q - Math.round(q)) > 1e-9) push("INVALID_STEP", `must be in steps of ${step}`);
      }
      return out;
    }
    case "rating": {
      if (typeof value !== "number" || !Number.isInteger(value)) return bad("a whole number");
      const scale = num(props["scale"]) ?? 5;
      if (value < 1 || value > scale) push("OUT_OF_RANGE", `must be between 1 and ${scale}`);
      return out;
    }
    case "currency": {
      if (!isPlainObject(value) || !strictKeys(value, ["minor", "currency"])) return bad("{minor, currency}");
      const minor = value["minor"];
      const cur = value["currency"];
      if (typeof minor !== "number" || !Number.isSafeInteger(minor)) return bad("integer minor units");
      if (typeof cur !== "string" || !CURRENCY_RE.test(cur)) return bad("an ISO 4217 currency code");
      const want = str(props["currency"]);
      if (want !== null && cur !== want) push("CURRENCY_MISMATCH", `currency must be ${want}`);
      range(minor, props["min"], props["max"]);
      return out;
    }
    case "id_number": {
      if (typeof value !== "string") return bad("a string");
      const scheme = str(props["scheme"]);
      if (scheme === "za_id") {
        if (!/^\d{13}$/.test(value)) push("INVALID_FORMAT", "an SA ID number has 13 digits");
        else if (!isValidZaId(value)) push("INVALID_CHECKSUM", "not a valid SA ID number");
      } else if (scheme === "passport") {
        if (!PASSPORT_RE.test(value)) push("INVALID_FORMAT", "not a valid passport number");
      }
      pattern(value);
      return out;
    }
    case "registration_number": {
      if (typeof value !== "string") return bad("a string");
      const scheme = str(props["scheme"]);
      if (scheme === "cipc" && !CIPC_RE.test(value)) push("INVALID_FORMAT", "CIPC numbers look like 2015/123456/07");
      if (scheme === "vat_za" && !VAT_ZA_RE.test(value)) push("INVALID_FORMAT", "SA VAT numbers are 10 digits starting with 4");
      pattern(value);
      return out;
    }
    case "boolean":
      return typeof value === "boolean" ? out : bad("true or false");
    case "tri_state":
      return value === "yes" || value === "no" || value === "na" ? out : bad('"yes", "no" or "na"');
    case "single_select":
    case "lookup":
      return typeof value === "string" ? out : bad("an option value");
    case "multi_select": {
      if (!Array.isArray(value) || !value.every((x) => typeof x === "string")) return bad("a list of option values");
      const vals = value as string[];
      if (new Set(vals).size !== vals.length) push("DUPLICATE_VALUE", "an option is selected twice");
      const min = num(props["min_select"]);
      const max = num(props["max_select"]);
      if (min !== null && vals.length < min) push("TOO_FEW", `select at least ${min}`);
      if (max !== null && vals.length > max) push("TOO_MANY", `select at most ${max}`);
      const exclusive = Array.isArray(props["exclusive_options"]) ? (props["exclusive_options"] as JsonValue[]) : [];
      if (vals.length > 1 && vals.some((x) => exclusive.includes(x))) {
        push("EXCLUSIVE_OPTION_COMBINED", "this option cannot be combined with others");
      }
      return out;
    }
    case "date": {
      if (typeof value !== "string" || !isIsoDate(value)) return bad("an ISO date (YYYY-MM-DD)");
      const min = str(props["min"]);
      const max = str(props["max"]);
      if (min !== null && value < min.slice(0, 10)) push("BELOW_MIN", `must be on or after ${min.slice(0, 10)}`);
      if (max !== null && value > max.slice(0, 10)) push("ABOVE_MAX", `must be on or before ${max.slice(0, 10)}`);
      return out;
    }
    case "time": {
      if (typeof value !== "string" || !TIME_RE.test(value)) return bad("a time (HH:mm)");
      const min = str(props["min"]);
      const max = str(props["max"]);
      if (min !== null && value < min) push("BELOW_MIN", `must be at or after ${min}`);
      if (max !== null && value > max) push("ABOVE_MAX", `must be at or before ${max}`);
      return out;
    }
    case "datetime": {
      if (typeof value !== "string" || !isIsoDateTime(value)) return bad("an ISO datetime with offset");
      const t = Date.parse(value);
      const min = str(props["min"]);
      const max = str(props["max"]);
      if (min !== null && DATETIME_RE.test(min) && t < Date.parse(min)) push("BELOW_MIN", `must be at or after ${min}`);
      if (max !== null && DATETIME_RE.test(max) && t > Date.parse(max)) push("ABOVE_MAX", `must be at or before ${max}`);
      return out;
    }
    case "duration": {
      if (!isPlainObject(value) || !strictKeys(value, ["value", "unit"])) return bad("{value, unit}");
      const n = value["value"];
      const unit = value["unit"];
      if (typeof n !== "number" || !Number.isInteger(n) || n < 0) return bad("a whole, non-negative duration");
      const allowed = Array.isArray(props["units"]) ? (props["units"] as JsonValue[]) : DURATION_UNITS;
      if (typeof unit !== "string" || !allowed.includes(unit)) push("INVALID_UNIT", `unit must be one of ${allowed.join(", ")}`);
      return out;
    }
    case "business_hours": {
      if (!isPlainObject(value)) return bad("an object of day groups");
      const groups = Array.isArray(props["groups"]) ? (props["groups"] as string[]) : HOUR_GROUPS;
      for (const k of Object.keys(value)) if (!groups.includes(k)) push("INVALID_FORMAT", `unknown day group "${k}"`);
      for (const g of groups) {
        const h = value[g];
        if (h === undefined) {
          push("MISSING_GROUP", `hours for "${g}" are missing`);
          continue;
        }
        if (h === "closed") continue;
        if (h === "24h") {
          if (props["allow_24h"] !== true) push("INVALID_HOURS", `"24h" is not allowed for "${g}"`);
          continue;
        }
        if (!isPlainObject(h) || !strictKeys(h, ["open", "close"]) || typeof h["open"] !== "string" || typeof h["close"] !== "string" || !TIME_RE.test(h["open"]) || !TIME_RE.test(h["close"]) || h["open"] === h["close"]) {
          push("INVALID_HOURS", `hours for "${g}" must be "closed"${props["allow_24h"] === true ? ', "24h"' : ""} or {open, close} (HH:mm)`);
        }
      }
      return out;
    }
    case "address": {
      if (!isPlainObject(value) || !strictKeys(value, ["line1", "line2", "suburb", "city", "province", "postal_code", "pin"])) {
        return bad("a structured address");
      }
      for (const k of ["line1", "city", "province"]) {
        const s = value[k];
        if (typeof s !== "string" || s.trim() === "") push("INVALID_FORMAT", `address ${k} is required`);
      }
      for (const k of ["line1", "line2", "suburb", "city", "province", "postal_code"]) {
        const s = value[k];
        if (s !== undefined && s !== null && (typeof s !== "string" || s.length > 200)) push("INVALID_FORMAT", `address ${k} must be text`);
      }
      const provinces = Array.isArray(props["provinces"]) ? (props["provinces"] as JsonValue[]) : null;
      if (provinces && typeof value["province"] === "string" && !provinces.includes(value["province"])) push("INVALID_OPTION", "unknown province");
      const pin = value["pin"];
      const mode = str(props["map_pin"]) ?? "optional";
      if (pin === undefined || pin === null) {
        if (mode === "required") push("PIN_REQUIRED", "a map pin is required");
      } else if (mode === "none") {
        push("PIN_NOT_ALLOWED", "this address takes no map pin");
      } else if (!isPoint(pin, ["source"]) || !PIN_SOURCES.includes(String((pin as JsonObject)["source"]))) {
        push("INVALID_FORMAT", "pin must be {lat, lng, source}");
      }
      return out;
    }
    case "location_pin": {
      if (!isPoint(value, ["source"]) || !PIN_SOURCES.includes(String((value as JsonObject)["source"]))) return bad("{lat, lng, source}");
      const max = num(props["max_distance_from_job_m"]);
      const jobLoc = env.job !== undefined ? readPath(env.job, "location") : undefined;
      if (max !== null && jobLoc !== undefined && jobLoc !== null) {
        try {
          const a = toPoint(value, "location_pin");
          const b = toPoint(jobLoc, "job.location");
          if (a && b && haversineM(a, b) > max) push("TOO_FAR", `must be within ${max} m of the job location`);
        } catch {
          /* c8 ignore next — malformed job location is a context problem, not the agent's */
        }
      }
      return out;
    }
    case "current_location": {
      const extra = ["accuracy_m", "ts", "gnss_ts", "is_mocked"];
      if (!isPoint(value, extra)) return bad("a GPS fix {lat, lng, accuracy_m, ts, gnss_ts?, is_mocked}");
      const o = value as JsonObject;
      const acc = num(o["accuracy_m"]);
      if (acc === null || acc < 0) return bad("accuracy_m ≥ 0");
      if (typeof o["ts"] !== "string" || !isIsoDateTime(o["ts"])) return bad("ts as ISO datetime with offset");
      if (o["gnss_ts"] !== undefined && o["gnss_ts"] !== null && (typeof o["gnss_ts"] !== "string" || !isIsoDateTime(o["gnss_ts"]))) return bad("gnss_ts as ISO datetime");
      if (typeof o["is_mocked"] !== "boolean") return bad("is_mocked boolean");
      const max = num(props["max_accuracy_m"]);
      if (max !== null && acc > max) push("ACCURACY_TOO_LOW", `GPS accuracy must be ${max} m or better`);
      return out;
    }
    case "photo": {
      if (!Array.isArray(value) || !value.every((x) => typeof x === "string" && UUID_RE.test(x))) return bad("a list of evidence ids");
      if (new Set(value).size !== value.length) push("DUPLICATE_VALUE", "the same photo is listed twice");
      const min = num(props["min_count"]);
      const max = num(props["max_count"]);
      if (min !== null && value.length < min) push("TOO_FEW", `at least ${min} photos are required`);
      if (max !== null && value.length > max) push("TOO_MANY", `at most ${max} photos are allowed`);
      return out;
    }
    case "signature":
      return typeof value === "string" && UUID_RE.test(value) ? out : bad("an evidence id");
    case "declaration": {
      if (!isPlainObject(value) || !strictKeys(value, ["accepted", "declaration_version_id", "accepted_at"])) return bad("{accepted, declaration_version_id, accepted_at}");
      if (typeof value["declaration_version_id"] !== "string" || !UUID_RE.test(value["declaration_version_id"])) return bad("declaration_version_id uuid");
      if (typeof value["accepted_at"] !== "string" || !isIsoDateTime(value["accepted_at"])) return bad("accepted_at ISO datetime");
      if (value["accepted"] !== true) push("NOT_ACCEPTED", "the declaration must be accepted");
      return out;
    }
    case "acknowledgement":
      if (typeof value !== "boolean") return bad("true");
      if (value !== true) push("NOT_ACCEPTED", "must be acknowledged");
      return out;
    case "consent": {
      if (!isPlainObject(value) || !strictKeys(value, ["given", "text_version_id", "at", "by_name"])) return bad("{given, text_version_id, at, by_name}");
      if (typeof value["given"] !== "boolean") return bad("given boolean");
      if (typeof value["text_version_id"] !== "string" || !UUID_RE.test(value["text_version_id"])) return bad("text_version_id uuid");
      if (typeof value["at"] !== "string" || !isIsoDateTime(value["at"])) return bad("at ISO datetime");
      if (typeof value["by_name"] !== "string" || value["by_name"].trim() === "") return bad("by_name");
      return out;
    }
    case "matrix": {
      if (!isPlainObject(value)) return bad("an object of rows");
      const rows = Array.isArray(props["rows"]) ? (props["rows"] as JsonObject[]).map((r) => String(r["key"])) : [];
      const cols = Array.isArray(props["columns"]) ? (props["columns"] as JsonObject[]).map((c) => String(c["value"])) : [];
      const cell = str(props["cell_type"]);
      for (const [row, v] of Object.entries(value)) {
        if (!rows.includes(row)) {
          push("UNKNOWN_ROW", `unknown row "${row}"`);
          continue;
        }
        if (cell === "single" && !(typeof v === "string" && cols.includes(v))) push("INVALID_OPTION", `row "${row}": not a column value`);
        if (cell === "multi" && !(Array.isArray(v) && v.every((x) => typeof x === "string" && cols.includes(x)) && new Set(v).size === v.length)) {
          push("INVALID_OPTION", `row "${row}": must be distinct column values`);
        }
        if (cell === "text" && !(typeof v === "string" && v.length <= 500)) push("INVALID_TYPE", `row "${row}": must be text`);
      }
      const req = props["required_rows"];
      const required = req === "all" ? rows : Array.isArray(req) ? (req as JsonValue[]).map(String) : [];
      for (const r of required) {
        const v = value[r];
        if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) push("MISSING_ROW", `row "${r}" is required`);
      }
      return out;
    }
    case "repeatable_group":
      return Array.isArray(value) ? out : bad("a list of items");
    default:
      // prefilled, computed: any JSON value is acceptable (checked against the recomputed value).
      return out;
  }
}
