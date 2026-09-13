/// Dependency injection: Riverpod providers in a container the module owns
/// (docs/03 §3). The container lives in [ModuleRuntime] and reaches widgets
/// through an `UncontrolledProviderScope` inside the entry point, so the
/// host needs no `ProviderScope` and never sees the module's providers.
library;

import 'package:fess_pos/src/bootstrap/bootstrap_snapshot.dart';
import 'package:fess_pos/src/core/runtime/module_runtime.dart';
import 'package:fess_pos/src/core/theme/pos_theme_data.dart';
import 'package:fess_pos/src/data/local/pos_database.dart';
import 'package:fess_pos/src/platform/platform_services.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Overridden by [ModuleRuntime] with itself.
final moduleRuntimeProvider = Provider<ModuleRuntime>(
  (ref) => throw StateError('moduleRuntimeProvider is set by ModuleRuntime'),
  name: 'moduleRuntime',
);

final platformServicesProvider = Provider<PlatformServices>(
  (ref) => ref.watch(moduleRuntimeProvider).dependencies.platform,
  name: 'platformServices',
);

/// The local store, opened on first use (T1-20).
final localDatabaseProvider = FutureProvider<PosDatabase>(
  (ref) => ref.watch(moduleRuntimeProvider).localStore(),
  name: 'localDatabase',
);

final bootstrapSnapshotProvider = Provider<BootstrapSnapshot>(
  (ref) => ref.watch(moduleRuntimeProvider).bootstrap,
  name: 'bootstrapSnapshot',
);

final posBrandProvider = Provider<PosBrand>((ref) {
  final runtime = ref.watch(moduleRuntimeProvider);
  return PosBrand.resolve(
    host: runtime.config.theme,
    config: runtime.bootstrap,
  );
}, name: 'posBrand');

final posThemeDataProvider = Provider<ThemeData>(
  (ref) => buildPosThemeData(ref.watch(posBrandProvider)),
  name: 'posThemeData',
);
