import 'dart:ui' show AppLifecycleState;

import 'package:drift/native.dart';
import 'package:fess_pos/fess_pos.dart';
import 'package:fess_pos/src/bootstrap/bootstrap_cache.dart';
import 'package:fess_pos/src/core/runtime/background_sync.dart';
import 'package:fess_pos/src/core/runtime/module_runtime.dart';
import 'package:fess_pos/src/data/local/pos_database.dart';
import 'package:fess_pos/src/data/outbox/outbox_store.dart';
import 'package:fess_pos/src/platform/background_work.dart';
import 'package:fess_pos/src/platform/secure_store.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/fake_platform.dart';
import '../support/test_host.dart';

void main() {
  final binding = TestWidgetsFlutterBinding.ensureInitialized();
  tearDown(ModuleRuntime.reset);

  Future<void> queueWork(PosDatabase db) => OutboxStore(db).add(
    const EnvelopeOrigin(deviceId: 'device-1', clientType: 'native'),
    type: 'client_error',
    typeVersion: 1,
    payload: const {'errors': <Object?>[]},
  );

  /// The app's lifecycle, as the platform reports it.
  Future<void> lifecycle(AppLifecycleState state) =>
      binding.defaultBinaryMessenger.handlePlatformMessage(
        SystemChannels.lifecycle.name,
        SystemChannels.lifecycle.codec.encodeMessage(state.toString()),
        (_) {},
      );

  test('registering saves what a background run starts from, and the '
      'periodic sync (T5-01)', () async {
    final store = MemorySecureStore();
    final work = FakeBackgroundWork();
    await startTestRuntime(
      platform: fakePlatform(secureStore: store, backgroundWork: work),
    );
    await PosModule.registerBackgroundWork();
    expect(work.registered, 1);
    final saved = await readBackgroundBootstrap(store);
    expect(saved?.apiBaseUrl, testBootstrap.apiBaseUrl);
    expect(saved?.publishableKey, testBootstrap.publishableKey);
    expect(saved?.environment, testBootstrap.environment);
  });

  test('leaving the app with work the server lacks asks for one more sync; '
      'with nothing waiting it asks for none', () async {
    final work = FakeBackgroundWork();
    final runtime = await startTestRuntime(
      platform: fakePlatform(backgroundWork: work),
    );
    await PosModule.registerBackgroundWork();
    final db = await runtime.localStore();
    addTearDown(() => lifecycle(AppLifecycleState.resumed));

    await lifecycle(AppLifecycleState.resumed);
    await lifecycle(AppLifecycleState.hidden);
    await Future<void>.delayed(const Duration(milliseconds: 100));
    expect(work.syncSoonCalls, 0, reason: 'nothing waiting');

    await lifecycle(AppLifecycleState.resumed);
    await queueWork(db);
    await lifecycle(AppLifecycleState.hidden);
    for (var i = 0; i < 50 && work.syncSoonCalls == 0; i++) {
      await Future<void>.delayed(const Duration(milliseconds: 20));
    }
    expect(work.syncSoonCalls, 1);
  });

  test('before initialize, registering says so', () async {
    await expectLater(
      PosModule.registerBackgroundWork(),
      throwsPosCode(PosErrorCodes.notInitialized),
    );
  });

  test('where there is no background work, nothing is saved', () async {
    final store = MemorySecureStore();
    await startTestRuntime(platform: fakePlatform(secureStore: store));
    await PosModule.registerBackgroundWork();
    expect(store.values.containsKey(backgroundBootstrapKey), isFalse);
  });

  test('a saved bootstrap that can no longer be read counts as none', () async {
    final store = MemorySecureStore();
    await store.write(backgroundBootstrapKey, '{"api_base_url": 3}');
    expect(await readBackgroundBootstrap(store), isNull);
  });

  group('a background run', () {
    late MemorySecureStore store;
    late PosDatabase db;

    setUp(() async {
      store = MemorySecureStore();
      db = PosDatabase(NativeDatabase.memory());
      await saveBackgroundBootstrap(store, testBootstrap);
    });

    ModuleDependencies deps(PosHostConfig config) => ModuleDependencies(
      platform: fakePlatform(secureStore: store),
      localStoreOpener: (_) async => db,
      bootstrapCache: MemoryBootstrapCache(),
      sessionGateway: FakeSessionGateway(),
    );

    test('starts from the saved bootstrap, and is tried again while work '
        'is left (T5-01)', () async {
      await queueWork(db);
      expect(
        await runBackgroundTask(
          BackgroundTasks.syncSoon,
          dependencies: deps,
          store: store,
        ),
        isFalse,
        reason: 'still queued: the platform tries again later',
      );
      expect(
        ModuleRuntime.current?.config.bootstrap.apiBaseUrl,
        testBootstrap.apiBaseUrl,
      );
    });

    test('a sync on leaving with nothing left is done', () async {
      expect(
        await runBackgroundTask(
          BackgroundTasks.syncSoon,
          dependencies: deps,
          store: store,
        ),
        isTrue,
      );
    });

    test('the periodic sync is always done: it comes round again', () async {
      await queueWork(db);
      expect(
        await runBackgroundTask(
          BackgroundTasks.periodicSync,
          dependencies: deps,
          store: store,
        ),
        isTrue,
      );
    });

    test('with no saved bootstrap, nothing starts', () async {
      addTearDown(db.close);
      expect(
        await runBackgroundTask(
          BackgroundTasks.syncSoon,
          dependencies: deps,
          store: MemorySecureStore(),
        ),
        isTrue,
      );
      expect(ModuleRuntime.current, isNull);
    });
  });
}
