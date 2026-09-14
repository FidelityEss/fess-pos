/// Label and text templates (docs/04 §3.1), as `src/definitions/templates.ts`
/// renders them: `"Photos of {{answers.other_business_name}}"`. Strings as
/// they are, numbers in their JCS/ECMAScript form, booleans as `true` /
/// `false`, anything else (null, missing, arrays, objects) as nothing.
library;

import 'package:fess_pos_engine/src/jcs.dart' show serializeNumber;
import 'package:fess_pos_engine/src/json.dart';

final RegExp _placeholder = RegExp(
  r'\{\{\s*([a-z_][a-z0-9_]*(?:\.[a-z0-9_]+)*)\s*\}\}',
);

String renderScalar(Object? v) => switch (v) {
  final String s => s,
  final num n => serializeNumber(n),
  final bool b => b ? 'true' : 'false',
  _ => '',
};

String renderTemplate(String s, Object? data) => s.replaceAllMapped(
  _placeholder,
  (m) => renderScalar(readPath(data, m[1]!)),
);
