import 'dart:math';

import 'package:fess_pos/fess_pos.dart';
import 'package:fess_pos/src/platform/database/key_policy.dart';
import 'package:fess_pos/src/platform/secure_store.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/test_host.dart';

/// A Keychain before the first unlock after a restart: reads fail.
class _LockedStore implements SecureStore {
  @override
  Future<String?> read(String key) =>
      Future.error(PlatformException(code: 'errSecInteractionNotAllowed'));

  @override
  Future<void> write(String key, String value) =>
      Future.error(PlatformException(code: 'errSecInteractionNotAllowed'));

  @override
  Future<void> delete(String key) async {}
}

/// Accepts writes and keeps nothing.
class _ForgetfulStore implements SecureStore {
  @override
  Future<String?> read(String key) async => null;

  @override
  Future<void> write(String key, String value) async {}

  @override
  Future<void> delete(String key) async {}
}

void main() {
  test(
    'a key is created only when there is neither a key nor a database',
    () async {
      final store = MemorySecureStore();
      final key = await resolveDatabaseKey(
        store: store,
        databaseExists: false,
        random: Random(1),
      );
      expect(key, matches(RegExp(r'^[0-9a-f]{64}$')));
      expect(store.values[databaseKeyName], key);
      expect(
        await resolveDatabaseKey(store: store, databaseExists: true),
        key,
        reason: 'the next open uses the same key',
      );
    },
  );

  test('a stored key is used, even if the database file is gone', () async {
    final store = MemorySecureStore()..values[databaseKeyName] = 'ab' * 32;
    expect(
      await resolveDatabaseKey(store: store, databaseExists: false),
      'ab' * 32,
    );
    expect(store.values[databaseKeyName], 'ab' * 32);
  });

  test('a database without its key is kept: no new key is made', () async {
    final store = MemorySecureStore();
    await expectLater(
      resolveDatabaseKey(store: store, databaseExists: true),
      throwsPosCode(PosErrorCodes.localStoreKeyMissing),
    );
    expect(store.values, isEmpty);
  });

  test('an unreadable key store fails closed, and may be retried', () async {
    await expectLater(
      resolveDatabaseKey(store: _LockedStore(), databaseExists: true),
      throwsA(
        isA<PosException>()
            .having(
              (e) => e.code,
              'code',
              PosErrorCodes.localStoreKeyUnreadable,
            )
            .having((e) => e.retryable, 'retryable', isTrue),
      ),
    );
  });

  test('a malformed stored key is refused and left as it is', () async {
    final store = MemorySecureStore()..values[databaseKeyName] = 'not-a-key';
    await expectLater(
      resolveDatabaseKey(store: store, databaseExists: true),
      throwsPosCode(PosErrorCodes.localStoreKeyRejected),
    );
    expect(store.values[databaseKeyName], 'not-a-key');
  });

  test('a key that could not be stored is never used', () async {
    await expectLater(
      resolveDatabaseKey(store: _ForgetfulStore(), databaseExists: false),
      throwsPosCode(PosErrorCodes.localStoreKeyUnreadable),
    );
  });

  test('every install gets its own key', () async {
    final a = await resolveDatabaseKey(
      store: MemorySecureStore(),
      databaseExists: false,
    );
    final b = await resolveDatabaseKey(
      store: MemorySecureStore(),
      databaseExists: false,
    );
    expect(a, isNot(b));
  });
}
