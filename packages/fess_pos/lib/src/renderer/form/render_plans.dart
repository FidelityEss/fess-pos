import 'package:fess_pos_engine/fess_pos_engine.dart'
    show CompiledForm, compileForm;
import 'package:flutter/foundation.dart';

/// Compiles a form definition into its render plan (docs/03 §8, C2) on a
/// background isolate, so a long form doesn't hold up the screen; on the
/// web, which has no isolates, on the main thread. Fails with the engine's
/// error for a form this build can't use.
Future<CompiledForm> compileRenderPlan(Map<String, Object?> form) =>
    compute(compileForm, form, debugLabel: 'fess_pos compile form');
