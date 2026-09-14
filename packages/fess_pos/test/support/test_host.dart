import 'package:drift/native.dart';
import 'package:fess_pos/fess_pos.dart';
import 'package:fess_pos/src/bootstrap/bootstrap_cache.dart';
import 'package:fess_pos/src/core/runtime/module_runtime.dart';
import 'package:fess_pos/src/data/local/pos_database.dart';
import 'package:fess_pos/src/domain/session/session_gateway.dart';
import 'package:fess_pos/src/platform/platform_services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'fake_platform.dart';

/// A valid bootstrap pointing at nothing real.
final PosBootstrap testBootstrap = PosBootstrap(
  apiBaseUrl: Uri.parse('https://pos-qa.example.invalid/functions/v1/api'),
  publishableKey: 'sb_publishable_test',
  environment: PosEnvironment.qa,
);

PosHostConfig testConfig({
  PosBootstrap? bootstrap,
  PosTheme? theme,
  void Function(PosEvent event)? onEvent,
  void Function()? onUserActivity,
}) => PosHostConfig(
  bootstrap: bootstrap ?? testBootstrap,
  theme: theme,
  onEvent: onEvent,
  onUserActivity: onUserActivity,
);

PosIdentity testIdentity() => PosIdentity(
  profile: PosUserProfile(
    employeeNumber: 'E0001',
    firstName: 'Test',
    lastName: 'Agent',
  ),
  getIdentityToken: () async =>
      const PosIdentityToken(token: 'host-token', issuer: 'pos_dev'),
);

class FakeSessionGateway implements SessionGateway {
  FakeSessionGateway({this.scope = PosSessionScope.full, this.error});

  final PosSessionScope scope;
  final Exception? error;
  int exchanges = 0;
  int uiAccessEnded = 0;

  /// What the gateway reports now; tests change it to act as the server.
  @override
  PosSessionInfo? current;

  @override
  Future<PosSessionInfo> exchange(PosIdentity identity) async {
    exchanges++;
    final e = error;
    if (e != null) throw e;
    return current = PosSessionInfo(scope: scope);
  }

  @override
  Future<void> endUiAccess() async => uiAccessEnded++;

  int reverifications = 0;

  @override
  Future<void> reverifyIfDue(Duration every) async => reverifications++;
}

/// Starts the module with test doubles. Pair with
/// `tearDown(ModuleRuntime.reset)`.
Future<ModuleRuntime> startTestRuntime({
  PosHostConfig? config,
  SessionGateway? gateway,
  String? cachedSnapshot,
  DateTime Function()? clock,
  PlatformServices? platform,
  Future<PosDatabase> Function(PlatformServices platform)? localStoreOpener,
}) => ModuleRuntime.start(
  config ?? testConfig(),
  dependencies: ModuleDependencies(
    platform: platform ?? fakePlatform(),
    localStoreOpener:
        localStoreOpener ?? (_) async => PosDatabase(NativeDatabase.memory()),
    bootstrapCache: MemoryBootstrapCache(cachedSnapshot),
    sessionGateway: gateway ?? FakeSessionGateway(),
    clock: clock ?? DateTime.now,
  ),
);

Matcher throwsPosCode(String code) =>
    throwsA(isA<PosException>().having((e) => e.code, 'code', code));
