// GENERATED — do not edit. Source: packages/fess_pos_engine_ts/src/errors.ts (run: node tools/vendor-engine.mjs)
import type { JsonObject } from "./json.ts";

/** Base class for every error the engine throws. `code` is stable and part of the fixture contract. */
export class EngineError extends Error {
  readonly code: string;
  readonly details: JsonObject | undefined;

  constructor(code: string, message: string, details?: JsonObject) {
    super(`${code}: ${message}`);
    this.name = "EngineError";
    this.code = code;
    this.details = details;
  }
}

/** Errors raised while checking or evaluating a rule expression (docs/04 §4). */
export class RuleError extends EngineError {
  constructor(code: string, message: string, details?: JsonObject) {
    super(code, message, details);
    this.name = "RuleError";
  }
}

/** Errors raised by RFC 8785 canonicalisation. */
export class JcsError extends EngineError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = "JcsError";
  }
}
