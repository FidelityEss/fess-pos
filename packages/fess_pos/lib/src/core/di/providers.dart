/// Dependency injection: Riverpod providers in a container the module owns
/// (docs/03 §3). The container lives in [ModuleRuntime] and reaches widgets
/// through an `UncontrolledProviderScope` inside the entry point, so the
/// host needs no `ProviderScope` and never sees the module's providers.
library;

import 'package:fess_pos/src/bootstrap/bootstrap_snapshot.dart';
import 'package:fess_pos/src/core/content/bundled_copy.dart';
import 'package:fess_pos/src/core/runtime/module_runtime.dart';
import 'package:fess_pos/src/core/theme/pos_theme_data.dart';
import 'package:fess_pos/src/data/local/pos_database.dart';
import 'package:fess_pos/src/data/local/repositories.dart';
import 'package:fess_pos/src/domain/forms/reason_codes.dart';
import 'package:fess_pos/src/domain/jobs/job_actions.dart';
import 'package:fess_pos/src/domain/jobs/job_record.dart';
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

final jobRepositoryProvider = FutureProvider<JobRepository>(
  (ref) async =>
      DriftJobRepository(await ref.watch(localDatabaseProvider.future)),
  name: 'jobRepository',
);

final definitionRepositoryProvider = FutureProvider<DefinitionRepository>(
  (ref) async =>
      DriftDefinitionRepository(await ref.watch(localDatabaseProvider.future)),
  name: 'definitionRepository',
);

final agentRepositoryProvider = FutureProvider<AgentRepository>(
  (ref) async =>
      DriftAgentRepository(await ref.watch(localDatabaseProvider.future)),
  name: 'agentRepository',
);

final referenceRepositoryProvider = FutureProvider<ReferenceRepository>(
  (ref) async =>
      DriftReferenceRepository(await ref.watch(localDatabaseProvider.future)),
  name: 'referenceRepository',
);

/// The reason codes from the last pull (docs/06 §3), live.
final reasonCodesProvider = StreamProvider<List<ReasonCode>>((ref) async* {
  yield* (await ref.watch(
    referenceRepositoryProvider.future,
  )).watchReasonCodes();
}, name: 'reasonCodes');

/// The agent's own jobs, live.
final myJobsProvider = StreamProvider<List<JobRecord>>((ref) async* {
  yield* (await ref.watch(jobRepositoryProvider.future)).watchMine();
}, name: 'myJobs');

/// One job, live; null once it's gone from the device.
// ignore: specify_nonobvious_property_types
final jobProvider = StreamProvider.family<JobRecord?, String>((ref, id) async* {
  yield* (await ref.watch(jobRepositoryProvider.future)).watchJob(id);
}, name: 'job');

/// Which definition: its kind and key, and the bank whose own takes
/// precedence (null: the default).
typedef DefinitionKey = ({String kind, String key, String? bankId});

/// The definition in force for a [DefinitionKey], live; null before one
/// arrives.
// ignore: specify_nonobvious_property_types
final activeDefinitionProvider =
    StreamProvider.family<Map<String, Object?>?, DefinitionKey>((
      ref,
      key,
    ) async* {
      final repo = await ref.watch(definitionRepositoryProvider.future);
      yield* repo.watchActive(key.kind, key.key, bankId: key.bankId);
    }, name: 'activeDefinition');

/// As [activeDefinitionProvider], with the version id and hash a
/// submission names it by.
// ignore: specify_nonobvious_property_types
final activeDefinitionVersionProvider =
    StreamProvider.family<ActiveDefinition?, DefinitionKey>((ref, key) async* {
      final repo = await ref.watch(definitionRepositoryProvider.future);
      yield* repo.watchActiveVersion(key.kind, key.key, bankId: key.bankId);
    }, name: 'activeDefinitionVersion');

/// Recording job actions; null in builds without the POS API client.
final jobActionsProvider = FutureProvider<JobActions?>(
  (ref) => ref.watch(moduleRuntimeProvider).jobActions(),
  name: 'jobActions',
);

/// `me` from the last pull.
final agentProvider = StreamProvider<Map<String, Object?>?>((ref) async* {
  yield* (await ref.watch(agentRepositoryProvider.future)).watchMe();
}, name: 'agent');

/// The home-tile totals from the last pull.
final agentTotalsProvider = StreamProvider<Map<String, Object?>?>((
  ref,
) async* {
  yield* (await ref.watch(agentRepositoryProvider.future)).watchTotals();
}, name: 'agentTotals');

/// Copy by key: the server's `core` content strings over the bundled
/// defaults (docs/04 §3.5).
final copyProvider = Provider<String Function(String key)>((ref) {
  final content = switch (ref.watch(
    activeDefinitionProvider((kind: 'content', key: 'core', bankId: null)),
  )) {
    AsyncData(:final value) => value,
    _ => null,
  };
  final strings = content?['strings'];
  final server = strings is Map<String, Object?> ? strings : null;
  return (key) {
    final s = server?[key];
    return s is String ? s : BundledCopy.text(key);
  };
}, name: 'copy');
