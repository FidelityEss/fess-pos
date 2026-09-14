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
import 'package:fess_pos/src/data/local/local_store.dart';
import 'package:fess_pos/src/data/local/pos_database.dart';
import 'package:fess_pos/src/data/outbox/outbox_sender.dart';
import 'package:fess_pos/src/data/outbox/outbox_store.dart';
import 'package:fess_pos/src/data/remote/api_session_gateway.dart';
import 'package:fess_pos/src/data/remote/api_transport.dart';
import 'package:fess_pos/src/data/remote/pos_api_client.dart';
import 'package:fess_pos/src/data/remote/session_vault.dart';
import 'package:fess_pos/src/data/sync/pull_engine.dart';
import 'package:fess_pos/src/data/sync/sections.dart';
import 'package:fess_pos/src/data/sync/sync_engine.dart';
import 'package:fess_pos/src/domain/session/session_gateway.dart';
import 'package:fess_pos/src/platform/connectivity.dart';
import 'package:fess_pos/src/platform/platform_services.dart';
import 'package:fess_pos/src/platform/secure_store.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
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
  StreamSubscription<NetworkState>? _network;

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
      return await engine.syncNow();
    } on Object catch (e, st) {
      _log.warning('sync could not run', error: e, stackTrace: st);
      return null;
    }
  }

  /// Something to sync (an action, a push hint): soon, if syncing runs.
  void nudgeSync() => _sync?.nudge();

  SyncEngine _newSyncEngine(PosApiClient client, PosDatabase db) {
    final outbox = OutboxStore(db, clock: dependencies.clock);
    const clientType = kIsWeb ? 'web' : 'native';
    return SyncEngine(
      sender: OutboxSender(store: outbox, client: client),
      puller: PullEngine(
        db: db,
        client: client,
        outbox: outbox,
        bootstrapCache: dependencies.bootstrapCache,
        capabilities: capabilityReport(clientType, null),
        sections: [JobsSection(db), DefinitionsSection(db)],
        clock: dependencies.clock,
      ),
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
    await dependencies.sessionGateway.endUiAccess();
    emit(PosEvent(PosEvent.signedOut));
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
    dependencies.apiClient?.close();
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
