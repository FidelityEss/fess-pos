@TestOn('vm')
library;

import 'dart:convert';
import 'dart:io';

import 'package:fess_pos/fess_pos.dart';
import 'package:fess_pos/src/data/remote/session_vault.dart';
import 'package:fess_pos/src/domain/session/session_gateway.dart';
import 'package:fess_pos/src/platform/secure_store.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fake_pos_api.dart';
import '../../support/test_host.dart';

class _FlakyStore implements SecureStore {
  final Map<String, String> values = {};
  bool failReads = false;
  bool failWrites = false;

  @override
  Future<String?> read(String key) async =>
      failReads ? throw StateError('locked') : values[key];

  @override
  Future<void> write(String key, String value) async {
    if (failWrites) throw StateError('locked');
    values[key] = value;
  }

  @override
  Future<void> delete(String key) async => values.remove(key);

  @override
  Future<void> reset() async => values.clear();
}

Map<String, Object?> _fixture(String name) =>
    (jsonDecode(
              File('../../schema/fixtures/api/$name.json').readAsStringSync(),
            )
            as Map<String, Object?>)['value']!
        as Map<String, Object?>;

StoredSession _session(DateTime at) => StoredSession.fromTokens(
  sessionAnswer(serverTime: at),
  issuer: 'pos_dev',
  receivedAt: at,
  verifiedAt: at,
);

void main() {
  group('device id', () {
    test('is created once and kept', () async {
      final store = _FlakyStore();
      var minted = 0;
      String mint() => '0000000${++minted}-2222-4333-8444-555555555555';
      final first = await SessionVault(store, newDeviceId: mint).deviceId();
      final again = await SessionVault(store, newDeviceId: mint).deviceId();
      expect(again, first);
      expect(minted, 1);
    });

    test('is never replaced because storage is locked right now', () async {
      final store = _FlakyStore();
      await SessionVault(store, newDeviceId: () => testDeviceId).deviceId();
      store.failReads = true;
      await expectLater(
        SessionVault(store, newDeviceId: () => 'another').deviceId(),
        throwsPosCode(PosErrorCodes.secureStoreUnavailable),
      );
      expect(store.values[SessionVault.deviceIdKey], testDeviceId);
    });
  });

  group('sessions', () {
    test('survive a restart and never print a token', () async {
      final store = MemorySecureStore();
      final at = DateTime.utc(2026, 9, 14, 8);
      await SessionVault(
        store,
      ).update((book) => book.put(_session(at)).activate('u-1'));
      final restored = (await SessionVault(store).read()).active!;
      expect(restored.user.id, 'u-1');
      expect(restored.refreshToken, refreshToken1);
      expect(restored.accessExpiresAt, at.add(const Duration(minutes: 15)));
      expect(restored.toString(), isNot(contains('access-1')));
      expect(restored.toString(), isNot(contains(refreshToken1)));
      expect(restored.user.toString(), isNot(contains('E0001')));
    });

    test('an unreadable entry is skipped; not JSON starts empty', () {
      final at = DateTime.utc(2026, 9, 14, 8);
      final good = _session(at).toJson();
      final book = SessionBook.fromStorage(
        jsonEncode({
          'active': 'u-1',
          'sessions': {
            'u-1': good,
            'u-2': {'session_id': 'x'},
          },
        }),
      );
      expect(book.sessions.keys, ['u-1']);
      expect(book.activeUserId, 'u-1');
      expect(SessionBook.fromStorage('not json').sessions, isEmpty);
      expect(SessionBook.fromStorage(null).active, isNull);
    });

    test('a session that could not be stored is still used', () async {
      final store = _FlakyStore()..failWrites = true;
      final vault = SessionVault(store);
      final at = DateTime.utc(2026, 9, 14, 8);
      await vault.update((book) => book.put(_session(at)).activate('u-1'));
      expect(vault.cached!.active!.user.id, 'u-1');
      expect((await vault.read()).active, isNotNull);
    });

    test('changes run one at a time', () async {
      final vault = SessionVault(MemorySecureStore());
      final at = DateTime.utc(2026, 9, 14, 8);
      await vault.update((book) => book.put(_session(at)).activate('u-1'));
      await Future.wait([
        vault.update(
          (b) => b.put(b.active!.copyWith(signOutPending: true)),
        ),
        vault.update((b) => b.put(b.active!.copyWith(uiAccess: false))),
      ]);
      final s = vault.cached!.active!;
      expect(s.signOutPending, isTrue);
      expect(s.uiAccess, isFalse);
    });
  });

  group('the contract fixtures', () {
    test('an exchange answer reads', () {
      final at = DateTime.utc(2026, 9, 10, 8, 31, 3);
      final s = StoredSession.fromTokens(
        _fixture('valid/auth_exchange_response'),
        issuer: 'fess_auth_api',
        receivedAt: at,
        verifiedAt: at,
      );
      expect(s.scope, PosSessionScope.full);
      expect(s.user.employeeNumber, 'E123');
      expect(s.accessExpiresAt, at.add(const Duration(minutes: 15)));
    });

    test('a scope other than full or ingest_only does not', () {
      final at = DateTime.utc(2026, 9, 10);
      expect(
        () => StoredSession.fromTokens(
          _fixture('invalid/auth_exchange_response_bad_scope'),
          issuer: 'fess_auth_api',
          receivedAt: at,
          verifiedAt: at,
        ),
        throwsPosCode(PosErrorCodes.responseMalformed),
      );
    });
  });
}
