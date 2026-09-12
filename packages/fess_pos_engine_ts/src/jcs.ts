/**
 * RFC 8785 JSON Canonicalization Scheme (JCS).
 *
 * - Object members sorted by the UTF-16 code units of their names (RFC 8785 §3.2.3).
 * - Numbers serialised with the ECMAScript Number-to-String algorithm (RFC 8785 §3.2.2.3),
 *   which is exactly what `String(n)` does in every conforming JS engine. `-0` → `0`.
 * - Strings serialised as ECMAScript `JSON.stringify` does (RFC 8785 §3.2.2.2); lone surrogates
 *   are rejected because they are not valid I-JSON.
 * - Non-finite numbers and non-JSON values are rejected.
 * - Object properties whose value is `undefined` are treated as absent (same as JSON serialisation).
 *
 * Error codes: JCS_NON_FINITE_NUMBER, JCS_LONE_SURROGATE, JCS_UNSUPPORTED_TYPE, JCS_TOO_DEEP.
 */
import { JcsError } from "./errors.ts";
import { isPlainObject } from "./json.ts";

const MAX_DEPTH = 1000;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

export function canonicalize(value: unknown): string {
  const out: string[] = [];
  write(value, out, 0);
  return out.join("");
}

function write(v: unknown, out: string[], depth: number): void {
  if (depth > MAX_DEPTH) throw new JcsError("JCS_TOO_DEEP", "value nests deeper than 1000 levels");
  if (v === null) {
    out.push("null");
    return;
  }
  switch (typeof v) {
    case "boolean":
      out.push(v ? "true" : "false");
      return;
    case "number":
      out.push(serializeNumber(v));
      return;
    case "string":
      out.push(serializeString(v));
      return;
    case "object":
      break;
    default:
      throw new JcsError("JCS_UNSUPPORTED_TYPE", `cannot canonicalise a value of type ${typeof v}`);
  }
  if (Array.isArray(v)) {
    out.push("[");
    for (let i = 0; i < v.length; i++) {
      if (i > 0) out.push(",");
      const el: unknown = v[i];
      if (el === undefined) throw new JcsError("JCS_UNSUPPORTED_TYPE", "array element is undefined");
      write(el, out, depth + 1);
    }
    out.push("]");
    return;
  }
  if (!isPlainObject(v)) {
    throw new JcsError("JCS_UNSUPPORTED_TYPE", "only plain objects can be canonicalised");
  }
  // Default Array#sort compares strings by UTF-16 code units, which is what RFC 8785 requires.
  const keys = Object.keys(v)
    .filter((k) => v[k] !== undefined)
    .sort();
  out.push("{");
  keys.forEach((k, i) => {
    if (i > 0) out.push(",");
    out.push(serializeString(k));
    out.push(":");
    write(v[k], out, depth + 1);
  });
  out.push("}");
}

export function serializeNumber(n: number): string {
  if (!Number.isFinite(n)) throw new JcsError("JCS_NON_FINITE_NUMBER", `number ${String(n)} is not finite`);
  if (Object.is(n, -0)) return "0";
  return String(n);
}

export function serializeString(s: string): string {
  if (LONE_SURROGATE.test(s)) throw new JcsError("JCS_LONE_SURROGATE", "string contains a lone surrogate");
  return JSON.stringify(s);
}
