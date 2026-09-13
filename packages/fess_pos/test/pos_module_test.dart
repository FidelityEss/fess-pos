import 'package:fess_pos/fess_pos.dart';
import 'package:fess_pos/src/bootstrap/bootstrap_snapshot.dart';
import 'package:fess_pos/src/core/runtime/module_runtime.dart';
import 'package:fess_pos/src/domain/session/session_gateway.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/test_host.dart';

void main() {
  tearDown(ModuleRuntime.reset);

  group('before initialize', () {
    test('access says notInitialized', () async {
      expect((await PosModule.access()).reason, PosAccessReason.notInitialized);
    });

    test('signIn fails with NOT_INITIALIZED', () {
      expect(
        PosModule.signIn(testIdentity()),
        throwsPosCode(PosErrorCodes.notInitialized),
      );
    });

    test('signOut is a harmless no-op', () async {
      await PosModule.signOut();
    });
  });

  group('initialize', () {
    test('refuses an invalid bootstrap and stays uninitialised', () async {
      final bad = testConfig(
        bootstrap: PosBootstrap(
          apiBaseUrl: Uri.parse('http://pos.example.invalid'),
          publishableKey: 'sb_publishable_x',
          environment: PosEnvironment.prod,
        ),
      );
      await expectLater(
        PosModule.initialize(bad),
        throwsPosCode(PosErrorCodes.bootstrapInvalid),
      );
      expect(ModuleRuntime.current, isNull);
    });

    test('is a no-op for the same config and refuses another', () async {
      final config = testConfig();
      final runtime = await startTestRuntime(config: config);
      await PosModule.initialize(config);
      expect(ModuleRuntime.current, same(runtime));
      await expectLater(
        PosModule.initialize(testConfig()),
        throwsPosCode(PosErrorCodes.alreadyInitialized),
      );
    });

    test('concurrent calls share one start', () async {
      final config = testConfig();
      final results = await Future.wait([
        PosModule.initialize(config),
        PosModule.initialize(config),
      ]);
      expect(results, hasLength(2));
      expect(ModuleRuntime.current, isNotNull);
    });

    test('tells the host it started', () async {
      final events = <String>[];
      await startTestRuntime(
        config: testConfig(onEvent: (e) => events.add(e.name)),
      );
      expect(events, [PosEvent.moduleInitialized]);
    });

    test('a throwing host callback does not break the module', () async {
      await startTestRuntime(
        config: testConfig(onEvent: (_) => throw StateError('host bug')),
      );
      expect(await PosModule.signIn(testIdentity()), isA<PosAccess>());
    });

    test(
      'without the API client, signIn says AUTH_UNAVAILABLE (T1-21)',
      () async {
        await PosModule.initialize(testConfig());
        await expectLater(
          PosModule.signIn(testIdentity()),
          throwsPosCode(PosErrorCodes.authUnavailable),
        );
        expect((await PosModule.access()).reason, PosAccessReason.notSignedIn);
      },
    );
  });

  group('access', () {
    test('a full session makes POS available', () async {
      await startTestRuntime();
      expect((await PosModule.access()).reason, PosAccessReason.notSignedIn);
      final access = await PosModule.signIn(testIdentity());
      expect(access.visible, isTrue);
      expect(await PosModule.access(), access);
    });

    test('an ingest-only session shows no UI', () async {
      await startTestRuntime(
        gateway: FakeSessionGateway(scope: PosSessionScope.ingestOnly),
      );
      final access = await PosModule.signIn(testIdentity());
      expect(access.reason, PosAccessReason.notSignedIn);
    });

    test('the pos.enabled kill switch hides POS even when signed in', () async {
      await startTestRuntime(
        cachedSnapshot: BootstrapSnapshot.fromResolvedConfig(const {
          'pos': {'enabled': false},
        }).toCacheJson(),
      );
      final access = await PosModule.signIn(testIdentity());
      expect(access.reason, PosAccessReason.disabled);
      expect(access.visible, isFalse);
    });

    test('signOut hides POS and ends UI access', () async {
      final gateway = FakeSessionGateway();
      final events = <String>[];
      await startTestRuntime(
        gateway: gateway,
        config: testConfig(onEvent: (e) => events.add(e.name)),
      );
      await PosModule.signIn(testIdentity());
      await PosModule.signOut();
      expect((await PosModule.access()).reason, PosAccessReason.notSignedIn);
      expect(gateway.uiAccessEnded, 1);
      expect(events, contains(PosEvent.signedOut));
    });

    test(
      'signOut(purge: true) deletes nothing and says NOT_SUPPORTED',
      () async {
        final gateway = FakeSessionGateway();
        await startTestRuntime(gateway: gateway);
        await PosModule.signIn(testIdentity());
        await expectLater(
          PosModule.signOut(purge: true),
          throwsPosCode(PosErrorCodes.notSupported),
        );
        expect(gateway.uiAccessEnded, 0);
        expect((await PosModule.access()).visible, isTrue);
      },
    );

    test('a failed exchange leaves the user signed out', () async {
      await startTestRuntime(
        gateway: FakeSessionGateway(
          error: const PosException(
            'EXCHANGE_REFUSED',
            'refused',
            kind: PosErrorKind.auth,
            retryable: false,
          ),
        ),
      );
      await expectLater(
        PosModule.signIn(testIdentity()),
        throwsPosCode('EXCHANGE_REFUSED'),
      );
      expect((await PosModule.access()).reason, PosAccessReason.notSignedIn);
    });
  });

  group('forwarded input', () {
    test('push payloads are recognised by their source', () async {
      expect(await PosModule.handlePushPayload({'source': 'fess_pos'}), isTrue);
      expect(await PosModule.handlePushPayload({'source': 'other'}), isFalse);
      expect(await PosModule.handlePushPayload({}), isFalse);
    });

    test('deep links under /pos, on either FESS scheme', () async {
      expect(
        await PosModule.handleDeepLink(
          Uri.parse('fidelity://fess.com/pos/job/1'),
        ),
        isTrue,
      );
      expect(
        await PosModule.handleDeepLink(Uri.parse('fess://pos/job/1')),
        isTrue,
      );
      expect(
        await PosModule.handleDeepLink(Uri.parse('fidelity://fess.com/home')),
        isFalse,
      );
    });
  });

  test('info reports the version axes', () {
    final info = PosModule.info;
    expect(info.moduleVersion, matches(RegExp(r'^\d+\.\d+\.\d+$')));
    expect(info.apiVersion, '1');
    expect(info.specVersion, '1.0');
  });

  test('user activity reaches the host at most every 5 s', () async {
    var now = DateTime(2026, 9, 13, 10);
    var calls = 0;
    final runtime = await startTestRuntime(
      config: testConfig(onUserActivity: () => calls++),
      clock: () => now,
    );
    runtime
      ..reportUserActivity()
      ..reportUserActivity();
    expect(calls, 1);
    now = now.add(ModuleRuntime.activityThrottle);
    runtime.reportUserActivity();
    expect(calls, 2);
  });
}
