/// Pure-Dart engine for the FESS POS module — the Dart twin of
/// `@fess-pos/engine` (packages/fess_pos_engine_ts).
///
/// Both engines run the same fixtures in `schema/fixtures`, which are the
/// contract (docs/DEVELOPMENT-GUIDELINES.md §3).
library;

export 'src/errors.dart';
export 'src/forms/catalogue.dart';
export 'src/forms/model.dart';
export 'src/forms/resolver.dart' show CompiledForm, compileForm, resolveForm;
export 'src/forms/session.dart';
export 'src/forms/templates.dart';
export 'src/forms/testcases.dart';
export 'src/forms/validator.dart';
export 'src/forms/values.dart'
    show
        ValueIssue,
        decimalPlaces,
        isEmptyAnswer,
        isValidZaId,
        validateValue,
        zaIdDerived;
export 'src/hash.dart';
export 'src/jcs.dart';
export 'src/json.dart' show deepEqual, jsonTypeOf, readPath;
export 'src/rules/check.dart'
    show
        ExpressionInfo,
        checkRuleExpression,
        isValidRuleExpression,
        operatorOf,
        ruleDependencies;
export 'src/rules/dates.dart' show isIsoDate, isIsoDateTime;
export 'src/rules/evaluate.dart'
    show
        RuleEnv,
        evaluateRule,
        evaluateRuleBoolean,
        haversineM,
        roundHalfAway,
        toGeoPoint;
export 'src/rules/spec.dart'
    show
        LiteralKind,
        OperatorSpec,
        RuleLimits,
        dateUnits,
        ruleErrorCodes,
        ruleOperators;
export 'src/submission_hash.dart';
