// D-52: a store that can never be opened again is moved aside intact,
// recorded, and replaced by a new one. Nothing is deleted.
@TestOn('vm')
library;

import 'dart:convert';
import 'dart:io';

import 'package:drift/drift.dart' show Value;
import 'package:drift/native.dart';
import 'package:fess_pos/fess_pos.dart';
import 'package:fess_pos/src/data/local/pos_database.dart';
import 'package:fess_pos/src/platform/database/key_policy.dart';
import 'package:fess_pos/src/platform/database/native_database.dart';
import 'package:fess_pos/src/platform/module_storage.dart';
import 'package:fess_pos/src/platform/secure_store.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/fake_platform.dart';

void main() {
  late Directory dir;
  setUp(() => dir = Directory.systemTemp.createTempSync('fess_pos_quar_'));
  tearDown(() => dir.deleteSync(recursive: true));

  File dbFile([String suffix = '']) =>
      File('${dir.path}/$databaseFileName$suffix');

  test('the files move together into quarantine/, intact', () async {
    dbFile().writeAsStringSync('main');
    dbFile('-wal').writeAsStringSync('wal');
    final name = await quarantineLocalDatabase(dir.path, reason: 'TEST');
    expect(dbFile().existsSync(), isFalse);
    expect(dbFile('-wal').existsSync(), isFalse);
    final moved = Directory('${dir.path}/$quarantineFolder');
    expect(File('${moved.path}/$name.db').readAsStringSync(), 'main');
    expect(File('${moved.path}/$name.db-wal').readAsStringSync(), 'wal');
  });

  test('a store whose key is gone is moved aside and a new key made', () async {
    dbFile().writeAsStringSync('restored from another phone');
    final secure = MemorySecureStore(); // the key never left that phone
    final opened = await openLocalExecutor(
      secureStore: secure,
      storage: FakeModuleStorage(dir.path),
    );
    await opened.executor.close();
    expect(opened.quarantined, hasLength(1));
    expect(dbFile().existsSync(), isFalse);
    expect(
      File(
        '${dir.path}/$quarantineFolder/${opened.quarantined.single}.db',
      ).readAsStringSync(),
      'restored from another phone',
    );
    expect(secure.values[databaseKeyName], matches(RegExp(r'^[0-9a-f]{64}$')));
  });

  test('an unreadable key never moves a store: it fails closed', () async {
    dbFile().writeAsStringSync('data');
    final secure = _Throwing();
    await expectLater(
      openLocalExecutor(
        secureStore: secure,
        storage: FakeModuleStorage(dir.path),
      ),
      throwsA(
        isA<PosException>().having(
          (e) => e.code,
          'code',
          PosErrorCodes.localStoreKeyUnreadable,
        ),
      ),
    );
    expect(dbFile().readAsStringSync(), 'data');
    expect(Directory('${dir.path}/$quarantineFolder').existsSync(), isFalse);
  });

  test('moves are recorded in module_meta for reporting', () async {
    final db = PosDatabase(NativeDatabase.memory());
    addTearDown(db.close);
    await db.recordQuarantine(['fess_pos-a']);
    await db.recordQuarantine(['fess_pos-b']);
    final row = await (db.select(
      db.moduleMeta,
    )..where((m) => m.key.equals(MetaKeys.quarantinedStores))).getSingle();
    final log = (jsonDecode(row.value) as List<Object?>)
        .cast<Map<String, Object?>>();
    expect(log.map((e) => e['name']), ['fess_pos-a', 'fess_pos-b']);
    expect(log.first['at'], isA<String>());
    // Value is imported to keep drift's query helpers in scope.
    expect(const Value(1).present, isTrue);
  });

  test('Android keeps the module folder in no_backup, beside files/', () {
    expect(
      AppSupportModuleStorage.moduleDirectoryFor(
        '/data/user/0/com.fidelity.fess/files',
        android: true,
      ),
      '/data/user/0/com.fidelity.fess/no_backup/fess_pos',
    );
    expect(
      AppSupportModuleStorage.moduleDirectoryFor(
        '/var/mobile/Containers/Data/Application/X/Library/Application Support',
        android: false,
      ),
      '/var/mobile/Containers/Data/Application/X/Library/Application Support/fess_pos',
    );
  });
}

class _Throwing implements SecureStore {
  @override
  Future<String?> read(String key) => Future.error(StateError('locked'));

  @override
  Future<void> write(String key, String value) =>
      Future.error(StateError('locked'));

  @override
  Future<void> delete(String key) => Future.error(StateError('locked'));

  @override
  Future<void> reset() => Future.error(StateError('locked'));
}
