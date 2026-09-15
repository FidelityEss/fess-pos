// The POS API client against QA (fess-pos-qa), end to end. Skipped unless
// POS_LIVE_CONFIG names the file tools/scenarios/module-harness.ts writes:
//
//   POS_LIVE_CONFIG=$HOME/.fess-pos/module-harness-qa.json \
//     flutter test test/live/qa_live_test.dart
//
// It refuses anything but QA. On QA it registers a test device and a few
// sessions for the agent, as a phone would; it creates no other data.
@TestOn('vm')
library;

import 'dart:convert';
import 'dart:io';

import 'package:drift/native.dart';
import 'package:fess_pos/fess_pos.dart';
import 'package:fess_pos/src/bootstrap/bootstrap_cache.dart';
import 'package:fess_pos/src/core/time/device_time.dart';
import 'package:fess_pos/src/core/version.dart';
import 'package:fess_pos/src/data/local/pos_database.dart';
import 'package:fess_pos/src/data/outbox/outbox_sender.dart';
import 'package:fess_pos/src/data/outbox/outbox_store.dart';
import 'package:fess_pos/src/data/remote/api_session_gateway.dart';
import 'package:fess_pos/src/data/remote/api_transport.dart';
import 'package:fess_pos/src/data/remote/pos_api_client.dart';
import 'package:fess_pos/src/data/remote/retry_policy.dart';
import 'package:fess_pos/src/data/remote/session_vault.dart';
import 'package:fess_pos/src/data/sync/pull_engine.dart';
import 'package:fess_pos/src/domain/session/session_gateway.dart';
import 'package:fess_pos/src/platform/device_info.dart';
import 'package:fess_pos/src/platform/secure_store.dart';
import 'package:flutter_test/flutter_test.dart';

class _LiveDevice implements DeviceInfoProvider {
  @override
  Future<int?> freeDiskBytes() async => null;

  @override
  Future<DeviceDescription> describe() async => const DeviceDescription(
    clientType: 'native',
    os: 'android',
    osVersion: 'live-test',
    model: 'fess_pos live test (VM)',
  );
}

void main() {
  final path = Platform.environment['POS_LIVE_CONFIG'];
  final file = path == null ? null : File(path);
  final skip = file == null || !file.existsSync()
      ? 'set POS_LIVE_CONFIG to the file module-harness.ts writes'
      : null;

  test(
    'QA: sign in, pull, update the device, refresh, sign out',
    () async {
      final cfg = jsonDecode(file!.readAsStringSync()) as Map<String, Object?>;
      expect(cfg['POS_ENVIRONMENT'], 'qa', reason: 'QA only, never production');

      final client = PosApiClient(
        transport: ApiTransport(
          bootstrap: PosBootstrap(
            apiBaseUrl: Uri.parse(cfg['POS_API_URL']! as String),
            publishableKey: cfg['POS_PUBLISHABLE_KEY']! as String,
            environment: PosEnvironment.qa,
          ),
        ),
        vault: SessionVault(MemorySecureStore()),
      );
      addTearDown(client.close);
      final gateway = ApiSessionGateway(
        client: client,
        deviceInfo: _LiveDevice(),
      );

      final health = await client.health();
      expect(health['ok'], isTrue);
      expect(health['env'], isNot('production'));

      final employee = cfg['POS_EMPLOYEE_NUMBER']! as String;
      final info = await gateway.exchange(
        PosIdentity(
          profile: PosUserProfile(
            employeeNumber: employee,
            firstName: 'Live',
            lastName: 'Test',
          ),
          getIdentityToken: () async => PosIdentityToken(
            token: cfg['POS_HOST_TOKEN']! as String,
            issuer: cfg['POS_HOST_ISSUER']! as String,
            issuedAt: DateTime.parse(
              cfg['POS_HOST_TOKEN_ISSUED_AT']! as String,
            ),
          ),
        ),
      );
      expect(info.scope, PosSessionScope.full);
      final session = client.vault.cached!.active!;
      expect(session.user.employeeNumber, employee);

      final page = await client.pull({'limit': 5});
      expect(page['server_epoch'], isA<String>());
      expect(
        (page['me']! as Map<String, Object?>)['employee_number'],
        employee,
      );

      final device = await client.updateDevice({
        'module_version': PosVersions.module,
      });
      expect(device['device_id'], await client.vault.deviceId());
      expect(device['module_version'], PosVersions.module);

      final refreshed = await client.refresh(session.user.id);
      expect(refreshed.refreshToken, isNot(session.refreshToken));
      expect(refreshed.accessToken, isNot(session.accessToken));
      await client.pull({'limit': 1});

      // The outbox and the pull against the real API: one client_error
      // envelope (a report, not agent data) must come back committed with
      // exactly the hash the module computed.
      final db = PosDatabase(NativeDatabase.memory());
      addTearDown(db.close);
      final outbox = OutboxStore(db);
      await outbox.add(
        EnvelopeOrigin(
          deviceId: await client.vault.deviceId(),
          clientType: 'native',
          userId: session.user.id,
          sessionId: session.sessionId,
        ),
        type: 'client_error',
        typeVersion: 1,
        payload: {
          'errors': [
            {
              'code': 'MODULE_LIVE_TEST',
              'kind': 'other',
              'about_envelope_id': null,
              'message': 'fess_pos live test against QA',
              'detail': <String, Object?>{},
              'at': isoWithOffset(DateTime.now()),
            },
          ],
        },
      );
      final drained = await OutboxSender(store: outbox, client: client).drain();
      expect(drained.outcomes, {'committed': 1});
      final pulled = await PullEngine(
        db: db,
        client: client,
        outbox: outbox,
        bootstrapCache: MemoryBootstrapCache(),
        capabilities: capabilityReport('native', 'android'),
      ).pull();
      expect(pulled.complete, isTrue);
      final config = await readRemoteConfig(db);
      expect(config.anomalies, isEmpty, reason: 'QA config keeps its schema');

      await gateway.endUiAccess();
      final after = client.vault.cached!.active!;
      expect(after.signOutPending, isFalse, reason: 'the server confirmed');
      expect(after.scope, PosSessionScope.ingestOnly);
      expect(gateway.current!.uiAccess, isFalse);

      try {
        await client.pull({'limit': 1});
        fail('a signed-out session must not pull');
      } on PosException catch (e) {
        expect(e.code, 'SCOPE_INSUFFICIENT');
        expect(classifyFailure(e), FailureAction.denied);
      }
    },
    skip: skip,
    timeout: const Timeout(Duration(minutes: 2)),
  );
}
