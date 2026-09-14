import 'dart:math';

import 'package:fess_pos/fess_pos.dart';
import 'package:fess_pos/src/platform/database/key_policy.dart';
import 'package:fess_pos/src/platform/secure_store.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/test_host.dart';

PlatformException _locked() =>
    PlatformException(code: 'errSecInteractionNotAllowed');

/// A Keychain before the first unlock after a restart: nothing works.
class _LockedStore implements SecureStore {
  @override
  Future<String?> read(String key) => Future.error(_locked());

  @override
  Future<void> write(String key, String value) => Future.error(_locked());

  @override
  Future<void> delete(String key) => Future.error(_locked());

  @override
  Future<void> reset() => Future.error(_locked());
}

/// A store restored from another phone's backup: unreadable until reset.
class _UndecryptableStore extends MemorySecureStore {
  bool broken = true;
  int resets = 0;

  @override
  Future<String?> read(String key) => broken
      ? Future.error(PlatformException(code: 'BadPadding'))
      : super.read(key);

  @override
  Future<void> reset() async {
    resets++;
    broken = false;
    await super.reset();
  }
}

/// Accepts writes and keeps nothing.
class _ForgetfulStore implements SecureStore {
  @override
  Future<String?> read(String key) async => null;

  @override
  Future<void> write(String key, String value) async {}

  @override
  Future<void> delete(String key) async {}

  @override
  Future<void> reset() async {}
}

final Matcher _hex64 = matches(RegExp(r'^[0-9a-f]{64}$'));

void main() {
  group('with a database', () {
    test('its stored key is used', () async {
      final store = MemorySecureStore()..values[databaseKeyName] = 'ab' * 32;
      expect(
        await resolveDatabaseKey(store: store, databaseExists: true),
        'ab' * 32,
      );
    });

    test(
      'an unreadable key fails closed, may be retried, changes nothing',
      () async {
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
        final restored = _UndecryptableStore();
        await expectLater(
          resolveDatabaseKey(store: restored, databaseExists: true),
          throwsPosCode(PosErrorCodes.localStoreKeyUnreadable),
        );
        expect(
          restored.resets,
          0,
          reason: 'never reset while data depends on it',
        );
      },
    );

    test('a key that is gone is reported, and no new key is made', () async {
      final store = MemorySecureStore();
      await expectLater(
        resolveDatabaseKey(store: store, databaseExists: true),
        throwsPosCode(PosErrorCodes.localStoreKeyMissing),
      );
      expect(store.values, isEmpty);
    });

    test('a malformed key is reported and left as it is', () async {
      final store = MemorySecureStore()..values[databaseKeyName] = 'not-a-key';
      await expectLater(
        resolveDatabaseKey(store: store, databaseExists: true),
        throwsPosCode(PosErrorCodes.localStoreKeyRejected),
      );
      expect(store.values[databaseKeyName], 'not-a-key');
    });
  });

  group('without a database (nothing depends on any key)', () {
    test('a key is made and stored', () async {
      final store = MemorySecureStore();
      final key = await resolveDatabaseKey(
        store: store,
        databaseExists: false,
        random: Random(1),
      );
      expect(key, _hex64);
      expect(store.values[databaseKeyName], key);
      expect(
        await resolveDatabaseKey(store: store, databaseExists: true),
        key,
        reason: 'the next open uses the same key',
      );
    });

    test('a stored valid key is reused', () async {
      final store = MemorySecureStore()..values[databaseKeyName] = 'ab' * 32;
      expect(
        await resolveDatabaseKey(store: store, databaseExists: false),
        'ab' * 32,
      );
    });

    test('a malformed key is replaced', () async {
      final store = MemorySecureStore()..values[databaseKeyName] = 'not-a-key';
      final key = await resolveDatabaseKey(store: store, databaseExists: false);
      expect(key, _hex64);
      expect(store.values[databaseKeyName], key);
    });

    test(
      'an undecryptable store (restored backup) is reset, then keyed',
      () async {
        final store = _UndecryptableStore()..values['bootstrap'] = 'x';
        final key = await resolveDatabaseKey(
          store: store,
          databaseExists: false,
        );
        expect(key, _hex64);
        expect(store.resets, 1);
        expect(store.values, {databaseKeyName: key});
      },
    );

    test(
      'a store that can be neither read nor reset fails, retryable',
      () async {
        await expectLater(
          resolveDatabaseKey(store: _LockedStore(), databaseExists: false),
          throwsPosCode(PosErrorCodes.localStoreKeyUnreadable),
        );
      },
    );

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
  });
}
