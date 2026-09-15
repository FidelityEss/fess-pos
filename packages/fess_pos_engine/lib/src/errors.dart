/// Base class for every error the engine throws. [code] is stable and part of
/// the fixture contract shared with the TypeScript engine.
class EngineError implements Exception {
  const EngineError(this.code, this.message, {this.details});

  final String code;
  final String message;
  final Map<String, Object?>? details;

  @override
  String toString() => '$code: $message';
}

/// Errors raised while checking or evaluating a rule expression (docs/04
/// §4). Codes are listed in `ruleErrorCodes`.
class RuleError extends EngineError {
  const RuleError(super.code, super.message, {super.details});
}

/// Errors raised by RFC 8785 canonicalisation.
///
/// Codes: `JCS_NON_FINITE_NUMBER`, `JCS_LONE_SURROGATE`,
/// `JCS_UNSUPPORTED_TYPE`, `JCS_TOO_DEEP`.
class JcsError extends EngineError {
  const JcsError(super.code, super.message);
}
