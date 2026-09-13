@TestOn('vm')
library;

import 'dart:io';

import 'package:drift/native.dart';
import 'package:fess_pos/fess_pos.dart';
import 'package:fess_pos/src/core/runtime/module_runtime.dart';
import 'package:fess_pos/src/data/local/local_store.dart';
import 'package:fess_pos/src/data/local/pos_database.dart';
import 'package:fess_pos/src/platform/database/key_policy.dart';
import 'package:fess_pos/src/platform/secure_store.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqlite3/sqlite3.dart';

import '../support/fake_platform.dart';
import '../support/test_host.dart';

void main() {
  tearDown(ModuleRuntime.reset);

  test('without SQLCipher the store fails closed and holds nothing', () async {
    // End to end through drift's background isolate, on the machine's plain
    // SQLite: the error code survives the isolate boundary.
    final dir = Directory.systemTemp.createTempSync('fess_pos_store_');
    addTearDown(() => dir.deleteSync(recursive: true));
    final secure = MemorySecureStore();
    final platform = fakePlatform(
      secureStore: secure,
      storage: FakeModuleStorage(dir.path),
    );

    await expectLater(
      openLocalStore(platform),
      throwsPosCode(PosErrorCodes.localStoreNotEncrypted),
    );
    expect(
      secure.values[databaseKeyName],
      isNotNull,
      reason: 'the key is kept for the next attempt',
    );
    final file = File('${dir.path}/fess_pos.db');
    if (file.existsSync()) {
      final raw = sqlite3.open(file.path);
      addTearDown(raw.dispose);
      expect(raw.select('SELECT name FROM sqlite_master'), isEmpty);
    }
  });

  test('with no module directory the store is unavailable', () async {
    await expectLater(
      openLocalStore(fakePlatform()),
      throwsPosCode(PosErrorCodes.localStoreUnavailable),
    );
  });

  group('localStoreFailure', () {
    test('passes a PosException through', () {
      const e = PosException(
        PosErrorCodes.localStoreKeyMissing,
        'x',
        kind: PosErrorKind.localStore,
        retryable: false,
      );
      expect(localStoreFailure(e), same(e));
    });

    test('recovers the code from text that crossed an isolate', () {
      final f = localStoreFailure(
        Exception('PosException(LOCAL_STORE_KEY_UNREADABLE, localStore): x'),
      );
      expect(f.code, PosErrorCodes.localStoreKeyUnreadable);
      expect(f.retryable, isTrue);
    });

    test('anything else is LOCAL_STORE_UNAVAILABLE, and retryable', () {
      final f = localStoreFailure(StateError('disk I/O error'));
      expect(f.code, PosErrorCodes.localStoreUnavailable);
      expect(f.retryable, isTrue);
    });
  });

  test(
    'the runtime opens the store once, and retries after a failure',
    () async {
      var calls = 0;
      var fail = true;
      final runtime = await startTestRuntime(
        localStoreOpener: (_) async {
          calls++;
          if (fail) {
            throw const PosException(
              PosErrorCodes.localStoreKeyUnreadable,
              'keychain locked',
              kind: PosErrorKind.localStore,
              retryable: true,
            );
          }
          return PosDatabase(NativeDatabase.memory());
        },
      );
      await expectLater(
        runtime.localStore(),
        throwsPosCode(PosErrorCodes.localStoreKeyUnreadable),
      );
      fail = false;
      final a = await runtime.localStore();
      final b = await runtime.localStore();
      expect(identical(a, b), isTrue);
      expect(calls, 2);
    },
  );
}
