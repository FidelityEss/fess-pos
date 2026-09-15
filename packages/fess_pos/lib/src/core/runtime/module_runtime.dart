import 'dart:async';

import 'package:fess_pos/src/bootstrap/bootstrap_cache.dart';
import 'package:fess_pos/src/bootstrap/bootstrap_snapshot.dart';
import 'package:fess_pos/src/bootstrap/bootstrap_validation.dart';
import 'package:fess_pos/src/contract/access.dart';
import 'package:fess_pos/src/contract/errors.dart';
import 'package:fess_pos/src/contract/events.dart';
import 'package:fess_pos/src/contract/host_config.dart';
import 'package:fess_pos/src/contract/identity.dart';
import 'package:fess_pos/src/core/di/providers.dart';
import 'package:fess_pos/src/core/logging/pos_logger.dart';
import 'package:fess_pos/src/core/observability/pos_observability.dart';
import 'package:fess_pos/src/core/version.dart';
import 'package:fess_pos/src/data/local/form_submissions_store.dart';
import 'package:fess_pos/src/data/local/inspection_store.dart';
import 'package:fess_pos/src/data/local/job_actions_store.dart';
import 'package:fess_pos/src/data/local/local_store.dart';
import 'package:fess_pos/src/data/local/pos_database.dart';
import 'package:fess_pos/src/data/local/tile_cache.dart';
import 'package:fess_pos/src/data/outbox/action_recorder.dart';
import 'package:fess_pos/src/data/outbox/outbox_sender.dart';
import 'package:fess_pos/src/data/outbox/outbox_store.dart';
import 'package:fess_pos/src/data/remote/api_session_gateway.dart';
import 'package:fess_pos/src/data/remote/api_transport.dart';
import 'package:fess_pos/src/data/remote/evidence_uploader.dart';
import 'package:fess_pos/src/data/remote/pos_api_client.dart';
import 'package:fess_pos/src/data/remote/push_registration.dart';
import 'package:fess_pos/src/data/remote/session_vault.dart';
import 'package:fess_pos/src/data/remote/tile_fetcher.dart';
import 'package:fess_pos/src/data/sync/evidence_uploads.dart';
import 'package:fess_pos/src/data/sync/pull_engine.dart';
import 'package:fess_pos/src/data/sync/sections.dart';
import 'package:fess_pos/src/data/sync/sync_engine.dart';
import 'package:fess_pos/src/domain/forms/form_submissions.dart';
import 'package:fess_pos/src/domain/inspections/inspections.dart';
import 'package:fess_pos/src/domain/jobs/job_actions.dart';
import 'package:fess_pos/src/domain/maps/map_tiles.dart';
import 'package:fess_pos/src/domain/navigation/pos_link.dart';
import 'package:fess_pos/src/domain/preview/preview_request.dart';
import 'package:fess_pos/src/domain/session/session_gateway.dart';
import 'package:fess_pos/src/platform/connectivity.dart';
import 'package:fess_pos/src/platform/platform_services.dart';
import 'package:fess_pos/src/platform/secure_store.dart';
import 'package:flutter/foundation.dart' show ValueNotifier, kIsWeb;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:meta/meta.dart';
import 'package:sentry/sentry.dart' show Transport;

const PosLogger _log = PosLogger('runtime');

/// Everything the module takes from the outside world. Tests swap these.
@immutable
class ModuleDependencies {
  const ModuleDependencies({
    required this.platform,
    required this.bootstrapCache,
    required this.sessionGateway,
    this.apiClient,
    this.localStoreOpener = openLocalStore,
    this.sentryTransport,
    this.clock = DateTime.now,
  });

  /// What `PosModule.initialize` uses in an app. Creating it sends nothing
  /// and touches no platform channel.
  factory ModuleDependencies.production(PosHostConfig config) {
    final platform = PlatformServices.forCurrentPlatform();
    final client = PosApiClient(
      transport: ApiTransport(bootstrap: config.bootstrap),
      vault: SessionVault(platform.secureStore),
    );
    return ModuleDependencies(
      platform: platform,
      bootstrapCache: SecureStoreBootstrapCache(platform.secureStore),
      apiClient: client,
      sessionGateway: ApiSessionGateway(
        client: client,
        deviceInfo: platform.deviceInfo,
        push: config.push,
      ),
    );
  }

  final PlatformServices platform;
  final BootstrapCache bootstrapCache;
  final SessionGateway sessionGateway;

  /// The POS API client; null in tests that don't need one.
  final PosApiClient? apiClient;

  /// Opens the local database. Tests pass an in-memory one.
  final Future<PosDatabase> Function(PlatformServices platform)
  localStoreOpener;
  final Transport? sentryTransport;
  final DateTime Function() clock;
}

/// The running module: one per app process, created by
/// `PosModule.initialize`. Module state, not host state — nothing here is
/// visible to or installed in the host.
final class ModuleRuntime {
  ModuleRuntime._(
    this.config,
    this._bootstrap,
    this.observability,
    this.dependencies,
  ) {
    container = ProviderContainer(
      overrides: [moduleRuntimeProvider.overrideWithValue(this)],
    );
  }

  static ModuleRuntime? _current;
  static Future<ModuleRuntime>? _starting;

  /// The runtime, or null before `initialize` completes.
  static ModuleRuntime? get current => _current;

  /// The runtime; throws [PosErrorCodes.notInitialized] before `initialize`.
  static ModuleRuntime get require =>
      _current ??
      (throw const PosException(
        PosErrorCodes.notInitialized,
        'call PosModule.initialize first',
        kind: PosErrorKind.notInitialized,
        retryable: false,
      ));

  /// Starts the module. Calling it again with the same config is a no-op;
  /// with a different config it fails, because the host initialises once.
  static Future<ModuleRuntime> start(
    PosHostConfig config, {
    ModuleDependencies? dependencies,
  }) {
    final current = _current;
    if (current != null) {
      if (identical(current.config, config)) return Future.value(current);
      return Future.error(
        const PosException(
          PosErrorCodes.alreadyInitialized,
          'PosModule.initialize was already called with another config',
          kind: PosErrorKind.config,
          retryable: false,
        ),
      );
    }
    return _starting ??= _start(
      config,
      dependencies ?? ModuleDependencies.production(config),
    ).whenComplete(() => _starting = null);
  }

  static Future<ModuleRuntime> _start(
    PosHostConfig config,
    ModuleDependencies dependencies,
  ) async {
    final problems = bootstrapProblems(config.bootstrap);
    if (problems.isNotEmpty) {
      throw PosException(
        PosErrorCodes.bootstrapInvalid,
        problems.join('; '),
        kind: PosErrorKind.config,
        retryable: false,
      );
    }
    // The bootstrap layer runs first, from cache, before any feature code.
    final snapshot = await loadBootstrapSnapshot(dependencies.bootstrapCache);
    final observability = PosObservability.create(
      dsn: snapshot.sentryDsn,
      sampleRate: snapshot.sentrySampleRate,
      environment: config.bootstrap.environment.name,
      transport: dependencies.sentryTransport,
    );
    final runtime = ModuleRuntime._(
      config,
      snapshot,
      observability,
      dependencies,
    );
    _current = runtime;
    _log.info('module initialised (${config.bootstrap.environment.name})');
    runtime.emit(PosEvent(PosEvent.moduleInitialized));
    return runtime;
  }

  /// Tears the module down. Tests only: a host initialises once per process.
  @visibleForTesting
  static Future<void> reset() async {
    final runtime = _current;
    _current = null;
    _starting = null;
    await runtime?._dispose();
  }

  final PosHostConfig config;
  final PosObservability observability;
  final ModuleDependencies dependencies;
  late final ProviderContainer container;

  BootstrapSnapshot _bootstrap;
  bool _uiAccess = false;
  DateTime? _lastActivityReport;
  Future<PosDatabase>? _localStore;
  SyncEngine? _sync;
  OutboxStore? _outbox;
  JobActions? _jobActions;
  Inspections? _inspections;
  FormSubmissions? _formSubmissions;
  ActionRecorder? _recorder;
  EvidenceUploader? _uploader;
  CachedTileSource? _tiles;
  Future<void>? _prefetching;
  PushRegistration? _pushRegistration;

  /// A forwarded deep link waiting for the POS screen to open it (T2-19).
  final ValueNotifier<PosLink?> pendingLink = ValueNotifier(null);
  StreamSubscription<NetworkState>? _network;

  static const String _clientType = kIsWeb ? 'web' : 'native';

  /// The cached kill switches and other bootstrap keys, read at start and
  /// refreshed by every pull that brings a config (docs/13 §6).
  BootstrapSnapshot get bootstrap => _bootstrap;

  /// The sync engine, built once the local store opens; null in builds
  /// without the POS API client.
  Future<SyncEngine?> syncEngine() async {
    final built = _sync;
    if (built != null) return built;
    final client = dependencies.apiClient;
    if (client == null) return null;
    final db = await localStore();
    return _sync ??= _newSyncEngine(client, db);
  }

  /// Syncs now and, with [keepRunning], keeps syncing on the engine's
  /// timer and when the network comes back. Never throws: a failure waits
  /// for the next trigger.
  Future<SyncRunReport?> runSync({bool keepRunning = true}) async {
    try {
      final engine = await syncEngine();
      if (engine == null) return null;
      if (keepRunning && !engine.started) {
        engine.start();
        _network ??= dependencies.platform.connectivity.changes.listen((s) {
          if (s.connected) engine.nudge();
        });
      }
      final report = await engine.syncNow();
      unawaited(_reconcilePush());
      return report;
    } on Object catch (e, st) {
      _log.warning('sync could not run', error: e, stackTrace: st);
      return null;
    }
  }

  /// Something to sync (an action, a push hint): soon, if syncing runs.
  void nudgeSync() => _sync?.nudge();

  /// Syncs soon: nudges the running sync engine, or runs one pass when it
  /// isn't running (e.g. a push handled before sign-in or in background).
  void syncSoon() {
    final engine = _sync;
    if (engine != null && engine.started) {
      engine.nudge();
    } else {
      unawaited(runSync(keepRunning: false));
    }
  }

  /// Hands a forwarded deep link to the POS screen, which opens it once
  /// the agent is signed in.
  void openLink(PosLink link) {
    pendingLink.value = link;
    emit(PosEvent(PosEvent.deepLinkOpened, properties: {'page': link.page}));
  }

  /// Brings the push registration in step with the host's token and the
  /// session (T2-19). Never throws: a failed update is tried again.
  Future<void> _reconcilePush() async {
    final client = dependencies.apiClient;
    final push = config.push;
    if (client == null || push == null) return;
    try {
      final db = await localStore();
      await (_pushRegistration ??= PushRegistration(
        client: client,
        db: db,
        push: push,
        clock: dependencies.clock,
      )).reconcile();
    } on Object catch (e) {
      final code = e is PosException ? e.code : e.runtimeType.toString();
      _log.info('push registration not updated ($code); tried again later');
    }
  }

  /// Job actions (T2-16), recorded under the signed-in user's session;
  /// null in builds without the POS API client.
  Future<JobActions?> jobActions() async {
    final built = _jobActions;
    if (built != null) return built;
    final client = dependencies.apiClient;
    if (client == null) return null;
    final db = await localStore();
    return _jobActions ??= DriftJobActions(
      db: db,
      recorder: _recorderFor(db),
      origin: () => _activeOrigin(client),
      send: runSync,
    );
  }

  /// Drafts for "Preview on phone" links (docs/04 §10). None until the
  /// server serves them by token (T3-33): a preview link then says the
  /// preview isn't available.
  Future<PreviewDrafts?> previewDrafts() async => null;

  /// Generic form submissions (`record.submit`, T3-19), recorded under the
  /// signed-in user's session; null in builds without the POS API client.
  Future<FormSubmissions?> formSubmissions() async {
    final built = _formSubmissions;
    if (built != null) return built;
    final client = dependencies.apiClient;
    if (client == null) return null;
    final db = await localStore();
    return _formSubmissions ??= DriftFormSubmissions(
      db: db,
      recorder: _recorderFor(db),
      origin: () => _activeOrigin(client),
      send: runSync,
      clock: dependencies.clock,
    );
  }

  /// Inspections (T4-27), recorded under the signed-in user's session;
  /// null in builds without the POS API client.
  Future<Inspections?> inspections() async {
    final built = _inspections;
    if (built != null) return built;
    final client = dependencies.apiClient;
    if (client == null) return null;
    final db = await localStore();
    final platform = dependencies.platform;
    return _inspections ??= DriftInspections(
      outbox: _outboxFor(db),
      recorder: _recorderFor(db),
      origin: () => _activeOrigin(client),
      send: runSync,
      location: platform.location,
      integrity: platform.integrity,
      diagnostics: _diagnostics,
      clock: dependencies.clock,
    );
  }

  /// Who records an agent action now: the signed-in user.
  Future<EnvelopeOrigin?> _activeOrigin(PosApiClient client) async {
    final session = (await client.vault.read()).active;
    if (session == null) return null;
    return EnvelopeOrigin(
      deviceId: await client.vault.deviceId(),
      clientType: _clientType,
      userId: session.user.id,
      sessionId: session.sessionId,
    );
  }

  /// One action recorder, so its double-tap guard spans every action.
  ActionRecorder _recorderFor(PosDatabase db) =>
      _recorder ??= ActionRecorder(_outboxFor(db));

  /// The `diagnostics` a submission carries (`schema/api` common).
  Future<Map<String, Object?>> _diagnostics() async {
    const platforms = {'android', 'ios', 'web'};
    const fallback = kIsWeb ? 'web' : 'android';
    String cut(String s, int max) => s.length > max ? s.substring(0, max) : s;
    try {
      final d = await dependencies.platform.deviceInfo.describe();
      final host = d.hostAppVersion;
      return {
        'module_version': PosVersions.module,
        'platform': platforms.contains(d.os) ? d.os : fallback,
        'host_app_version': ?host == null ? null : cut(host, 60),
        'os_version': cut(d.osVersion, 60),
        'model': cut(d.model, 120),
        'extra': {'os': d.os},
      };
    } on Object {
      return {'module_version': PosVersions.module, 'platform': fallback};
    }
  }

  /// Map tiles (T2-17): cached on the phone, fetched from the provider in
  /// remote config.
  Future<TileSource> mapTiles() => _tileCache();

  Future<CachedTileSource> _tileCache() async {
    final built = _tiles;
    if (built != null) return built;
    final db = await localStore();
    return _tiles ??= CachedTileSource(
      db: db,
      fetcher: TileFetcher(),
      moduleDirectory: dependencies.platform.storage.moduleDirectory,
      config: () => readRemoteConfig(db),
      clock: dependencies.clock,
    );
  }

  /// Keeps the map around the agent's jobs for offline use, after a pull;
  /// one run at a time. Never throws.
  void _prefetchTiles() {
    _prefetching ??= () async {
      try {
        final tiles = await _tileCache();
        await tiles.prefetchAssigned(
          await dependencies.platform.connectivity.current(),
        );
      } on Object catch (e, st) {
        _log.warning('map tiles were not prefetched', error: e, stackTrace: st);
      } finally {
        _prefetching = null;
      }
    }();
  }

  /// One outbox for the store: the sync engine and the action recorder
  /// share it.
  OutboxStore _outboxFor(PosDatabase db) =>
      _outbox ??= OutboxStore(db, clock: dependencies.clock);

  SyncEngine _newSyncEngine(PosApiClient client, PosDatabase db) {
    final outbox = _outboxFor(db);
    const clientType = _clientType;
    return SyncEngine(
      sender: OutboxSender(store: outbox, client: client),
      puller: PullEngine(
        db: db,
        client: client,
        outbox: outbox,
        bootstrapCache: dependencies.bootstrapCache,
        capabilities: capabilityReport(clientType, null),
        sections: [
          JobsSection(db),
          DefinitionsSection(db),
          CardsSection(db, clock: dependencies.clock),
          SessionTokensSection(db, clock: dependencies.clock),
          DeclarationsSection(db, clock: dependencies.clock),
          EvidenceSection(db, clock: dependencies.clock),
        ],
        clock: dependencies.clock,
      ),
      uploadEvidence: EvidenceUploads(
        outbox: outbox,
        client: client,
        uploader: _uploader ??= EvidenceUploader(
          publishableKey: config.bootstrap.publishableKey,
        ),
        originFor: (userId) async => EnvelopeOrigin(
          deviceId: await client.vault.deviceId(),
          clientType: clientType,
          userId: userId,
          sessionId: (await client.vault.read()).sessions[userId]?.sessionId,
        ),
        clock: dependencies.clock,
      ).run,
      outbox: outbox,
      deviceOrigin: () async => EnvelopeOrigin(
        deviceId: await client.vault.deviceId(),
        clientType: clientType,
      ),
      canPull: () => signedIn,
      reverify: (config) =>
          dependencies.sessionGateway.reverifyIfDue(config.reverifyEvery),
      onPulled: (report) {
        final snapshot = report.bootstrap;
        if (snapshot != null) _bootstrap = snapshot;
        _prefetchTiles();
        unawaited(_reconcilePush());
      },
      clock: dependencies.clock,
    );
  }

  /// The local store, opened on first use.
  ///
  /// If opening fails, the failure is logged and reported and the next call
  /// tries again: a key that couldn't be read may be readable once the phone
  /// is unlocked. Nothing is ever deleted to make opening succeed.
  Future<PosDatabase> localStore() async {
    final existing = _localStore;
    if (existing != null) return existing;
    final opening = Future.sync(
      () => dependencies.localStoreOpener(dependencies.platform),
    );
    _localStore = opening;
    try {
      return await opening;
    } on Object catch (e, st) {
      if (identical(_localStore, opening)) _localStore = null;
      final code = e is PosException ? e.code : e.runtimeType.toString();
      _log.error('local store unavailable: $code', error: e, stackTrace: st);
      unawaited(observability.captureException(e, stackTrace: st));
      rethrow;
    }
  }

  /// The minimum gap between two `onUserActivity` calls to the host.
  static const Duration activityThrottle = Duration(seconds: 5);

  /// Signed in during this process, with a session that may still show the
  /// UI. The gateway's view changes when the server ends or narrows the
  /// session, e.g. a revoked device or a deactivated agent.
  bool get signedIn {
    final session = dependencies.sessionGateway.current;
    return _uiAccess &&
        session != null &&
        session.uiAccess &&
        session.scope == PosSessionScope.full;
  }

  Future<PosAccess> signIn(PosIdentity identity) async {
    final session = await dependencies.sessionGateway.exchange(identity);
    _uiAccess = session.scope == PosSessionScope.full && session.uiAccess;
    emit(PosEvent(PosEvent.signedIn, properties: {'offline': session.offline}));
    unawaited(runSync());
    unawaited(_reconcilePush());
    return access();
  }

  /// Ends UI access. Queued work keeps uploading under the `ingest_only`
  /// session (docs/03 §3). Purging isn't available until the sync layer can
  /// show what is pending (T5-09); asking for it deletes nothing.
  Future<void> signOut({required bool purge}) async {
    if (purge) {
      throw const PosException(
        PosErrorCodes.notSupported,
        'purging local data needs the sync layer (T5-09); nothing was deleted',
        kind: PosErrorKind.unsupported,
        retryable: false,
      );
    }
    _uiAccess = false;
    pendingLink.value = null;
    await dependencies.sessionGateway.endUiAccess();
    emit(PosEvent(PosEvent.signedOut));
    // No more job hints to a phone whose agent has left.
    unawaited(_reconcilePush());
  }

  PosAccess access() {
    if (!bootstrap.posEnabled) return const PosAccess(PosAccessReason.disabled);
    if (!signedIn) return const PosAccess(PosAccessReason.notSignedIn);
    return const PosAccess(PosAccessReason.available);
  }

  /// Sends [event] to the host. A failing host callback is logged and
  /// otherwise ignored.
  void emit(PosEvent event) {
    final onEvent = config.onEvent;
    if (onEvent == null) return;
    try {
      onEvent(event);
    } on Object catch (e, st) {
      _log.warning('host onEvent callback threw', error: e, stackTrace: st);
    }
  }

  /// Tells the host the agent is active, at most every [activityThrottle].
  void reportUserActivity() {
    final onActivity = config.onUserActivity;
    if (onActivity == null) return;
    final now = dependencies.clock();
    final last = _lastActivityReport;
    if (last != null && now.difference(last) < activityThrottle) return;
    _lastActivityReport = now;
    try {
      onActivity();
    } on Object catch (e, st) {
      _log.warning(
        'host onUserActivity callback threw',
        error: e,
        stackTrace: st,
      );
    }
  }

  Future<void> _dispose() async {
    _sync?.stop();
    await _network?.cancel();
    _network = null;
    container.dispose();
    pendingLink.dispose();
    dependencies.apiClient?.close();
    _uploader?.close();
    final store = _localStore;
    _localStore = null;
    if (store != null) {
      try {
        await (await store).close();
      } on Object {
        // It never opened; there is nothing to close.
      }
    }
    await observability.close();
  }
}
