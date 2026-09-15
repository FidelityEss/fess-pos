/// Dependency injection: Riverpod providers in a container the module owns
/// (docs/03 §3). The container lives in [ModuleRuntime] and reaches widgets
/// through an `UncontrolledProviderScope` inside the entry point, so the
/// host needs no `ProviderScope` and never sees the module's providers.
library;

import 'dart:async';

import 'package:fess_pos/src/bootstrap/bootstrap_snapshot.dart';
import 'package:fess_pos/src/contract/capabilities.dart';
import 'package:fess_pos/src/core/content/bundled_app.dart';
import 'package:fess_pos/src/core/content/bundled_copy.dart';
import 'package:fess_pos/src/core/logging/pos_logger.dart';
import 'package:fess_pos/src/core/runtime/module_runtime.dart';
import 'package:fess_pos/src/core/theme/pos_theme_data.dart';
import 'package:fess_pos/src/data/local/offline_readiness.dart';
import 'package:fess_pos/src/data/local/pos_database.dart';
import 'package:fess_pos/src/data/local/repositories.dart';
import 'package:fess_pos/src/data/outbox/outbox_store.dart';
import 'package:fess_pos/src/domain/app/app_spec.dart';
import 'package:fess_pos/src/domain/cards/cards.dart';
import 'package:fess_pos/src/domain/forms/form_submissions.dart';
import 'package:fess_pos/src/domain/forms/reason_codes.dart';
import 'package:fess_pos/src/domain/inspections/inspections.dart';
import 'package:fess_pos/src/domain/jobs/job_actions.dart';
import 'package:fess_pos/src/domain/jobs/job_record.dart';
import 'package:fess_pos/src/domain/maps/map_tiles.dart';
import 'package:fess_pos/src/domain/preview/preview_request.dart';
import 'package:fess_pos/src/domain/storage/storage_budget.dart';
import 'package:fess_pos/src/domain/sync/attention.dart';
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
/// What the outbox holds, live, for the sync status (docs/08 §8).
final syncStatusProvider = StreamProvider<OutboxStatus>((ref) async* {
  yield* OutboxStore(
    await ref.watch(localDatabaseProvider.future),
  ).watchStatus();
}, name: 'syncStatus');

/// What the server couldn't take, newest first (T4-13).
final needsAttentionProvider = StreamProvider<List<AttentionItem>>((
  ref,
) async* {
  yield* OutboxStore(
    await ref.watch(localDatabaseProvider.future),
  ).watchNeedsAttention().map(
    (rows) => [
      for (final r in rows)
        AttentionItem(
          id: r.id,
          type: r.type,
          createdAt: r.createdAt,
          reason: attentionReason(r.receipt, r.lastError),
        ),
    ],
  );
}, name: 'needsAttention');

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

/// Recording generic form submissions (`record.submit`, T3-19); null in
/// builds without the POS API client.
final formSubmissionsProvider = FutureProvider<FormSubmissions?>(
  (ref) => ref.watch(moduleRuntimeProvider).formSubmissions(),
  name: 'formSubmissions',
);

/// Drafts for "Preview on phone" links (T3-08); null until the server
/// serves them (T3-12).
final previewDraftsProvider = FutureProvider<PreviewDrafts?>(
  (ref) => ref.watch(moduleRuntimeProvider).previewDrafts(),
  name: 'previewDrafts',
);

/// Whether a sync run is going on now, for the sync status (docs/08 §8).
final syncingProvider = StreamProvider<bool>((ref) {
  final syncing = ref.watch(moduleRuntimeProvider).syncing;
  final controller = StreamController<bool>();
  void emit() => controller.add(syncing.value);
  syncing.addListener(emit);
  emit();
  ref.onDispose(() {
    syncing.removeListener(emit);
    unawaited(controller.close());
  });
  return controller.stream;
}, name: 'syncing');

/// Which of the agent's jobs are ready to work offline (docs/08 §8), live.
final offlineReadyJobsProvider = StreamProvider<Set<String>>((ref) async* {
  yield* OfflineReadiness(
    await ref.watch(localDatabaseProvider.future),
    clock: ref.watch(moduleRuntimeProvider).dependencies.clock,
  ).watch();
}, name: 'offlineReadyJobs');

/// How the phone's storage stands, measured when asked (docs/08 §5).
// ignore: specify_nonobvious_property_types
final storageUseProvider = FutureProvider.autoDispose<StorageUse>(
  (ref) => ref.watch(moduleRuntimeProvider).storageUse(),
  name: 'storageUse',
);

/// Inspections (T4-27); null in builds without the POS API client.
final inspectionsProvider = FutureProvider<Inspections?>(
  (ref) => ref.watch(moduleRuntimeProvider).inspections(),
  name: 'inspections',
);

/// The latest inspection of a job on this phone, live.
// ignore: specify_nonobvious_property_types
final latestInspectionProvider =
    StreamProvider.family<InspectionRecord?, String>((ref, jobId) async* {
      final inspections = await ref.watch(inspectionsProvider.future);
      if (inspections == null) {
        yield null;
        return;
      }
      yield* inspections.watchLatest(jobId);
    }, name: 'latestInspection');

/// One inspection, live.
// ignore: specify_nonobvious_property_types
final inspectionProvider = StreamProvider.family<InspectionRecord?, String>((
  ref,
  id,
) async* {
  final inspections = await ref.watch(inspectionsProvider.future);
  if (inspections == null) {
    yield null;
    return;
  }
  yield* inspections.watch(id);
}, name: 'inspection');

/// A definition version the phone holds, by id: what an inspection pinned.
// ignore: specify_nonobvious_property_types
final definitionVersionProvider =
    FutureProvider.family<Map<String, Object?>?, String>(
      (ref, versionId) async => (await ref.watch(
        definitionRepositoryProvider.future,
      )).version(versionId),
      name: 'definitionVersion',
    );

final declarationRepositoryProvider = FutureProvider<DeclarationRepository>(
  (ref) async =>
      DriftDeclarationRepository(await ref.watch(localDatabaseProvider.future)),
  name: 'declarationRepository',
);

/// The latest version of a declaration, live.
// ignore: specify_nonobvious_property_types
final declarationProvider = StreamProvider.family<Declaration?, String>((
  ref,
  key,
) async* {
  yield* (await ref.watch(declarationRepositoryProvider.future)).watch(key);
}, name: 'declaration');

final cardRepositoryProvider = FutureProvider<CardRepository>(
  (ref) async =>
      DriftCardRepository(await ref.watch(localDatabaseProvider.future)),
  name: 'cardRepository',
);

/// The agent's authorisation card token from the last pull, live.
final agentCardProvider = StreamProvider<CardToken?>((ref) async* {
  yield* (await ref.watch(cardRepositoryProvider.future)).watchAgentCard();
}, name: 'agentCard');

/// A job's authorisation card token, live.
// ignore: specify_nonobvious_property_types
final jobCardProvider = StreamProvider.family<CardToken?, String>((
  ref,
  jobId,
) async* {
  yield* (await ref.watch(cardRepositoryProvider.future)).watchJobCard(jobId);
}, name: 'jobCard');

/// The public verify page for a card token, on the POS API this module
/// talks to (docs/07 §10).
final verifyUrlProvider = Provider<Uri Function(String token)>((ref) {
  final base = ref.watch(moduleRuntimeProvider).config.bootstrap.apiBaseUrl;
  return (token) => verifyUrl(base, token);
}, name: 'verifyUrl');

/// Map tiles (T2-17): the phone's cache, else the provider in remote
/// config.
final tileSourceProvider = FutureProvider<TileSource>(
  (ref) => ref.watch(moduleRuntimeProvider).mapTiles(),
  name: 'tileSource',
);

/// How the map is set up (`maps.*`), read again each time a map shows, so
/// a provider configured by the last pull takes effect.
// ignore: specify_nonobvious_property_types
final mapSettingsProvider = FutureProvider.autoDispose<MapSettings>(
  (ref) async => (await ref.watch(tileSourceProvider.future)).settings(),
  name: 'mapSettings',
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
final copyProvider = Provider<String Function(String key)>(
  (ref) => ref.watch(bankCopyProvider(null)),
  name: 'copy',
);

/// Copy by key on a job's pages (B4.18): the job's bank's own `core`
/// strings, then the default `core`, then the bundled defaults. A bank's
/// content needs only the keys it changes.
// ignore: specify_nonobvious_property_types
final bankCopyProvider = Provider.family<String Function(String key), String?>(
  (ref, bankId) {
    Map<String, Object?>? strings(String? bank) {
      final content = switch (ref.watch(
        activeDefinitionProvider((kind: 'content', key: 'core', bankId: bank)),
      )) {
        AsyncData(:final value) => value,
        _ => null,
      };
      final s = content?['strings'];
      return s is Map<String, Object?> ? s : null;
    }

    final base = strings(null);
    final bank = bankId == null ? null : strings(bankId);
    return (key) {
      final s = bank?[key] ?? base?[key];
      return s is String ? s : BundledCopy.text(key);
    };
  },
  name: 'bankCopy',
);

/// An inspection's evidence as the phone holds it, live, without the
/// bytes: the evidence fields show captions and who signed from it, and
/// the job's receipt how its uploads are getting on.
// ignore: specify_nonobvious_property_types
final inspectionEvidenceProvider = StreamProvider.autoDispose
    .family<List<EvidenceItem>, String>((ref, inspectionId) async* {
      final inspections = await ref.watch(inspectionsProvider.future);
      if (inspections != null) yield* inspections.watchEvidence(inspectionId);
    }, name: 'inspectionEvidence');

const PosLogger _appLog = PosLogger('app');

/// The app in force for a bank's pages (docs/04 §3.6, T3-17): the bank's
/// own `agent_app`, else the default, checked. The bundled app stands in
/// until one arrives, and when the one in force can't be used, which is
/// logged.
// ignore: specify_nonobvious_property_types
final appSpecProvider = Provider.family<AppSpec, String?>((ref, bankId) {
  final active = switch (ref.watch(
    activeDefinitionProvider((kind: 'app', key: 'agent_app', bankId: bankId)),
  )) {
    AsyncData(:final value) => value,
    _ => null,
  };
  if (active != null) {
    try {
      return AppSpec.parse(
        active,
        pageTypes: supportedPageTypes.keys.toSet(),
      );
    } on AppSpecError catch (e) {
      _appLog.warning(
        "the app definition in force can't be used "
        '(${e.problems.join('; ')}); the bundled one stands in',
      );
    }
  }
  return BundledApp.spec;
}, name: 'appSpec');
