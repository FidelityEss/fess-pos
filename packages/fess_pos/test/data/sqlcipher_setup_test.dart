// Runs against the machine's plain (unencrypted) SQLite. That is exactly
// the situation the cipher check exists for: SQLite shadowing SQLCipher
// (findings/03 §2). Real SQLCipher is exercised on a device by the example's
// integration test.
@TestOn('vm')
library;

import 'dart:io';

import 'package:fess_pos/fess_pos.dart';
import 'package:fess_pos/src/platform/database/native_database.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqlite3/sqlite3.dart';

import '../support/test_host.dart';

void main() {
  late Directory dir;
  setUp(() => dir = Directory.systemTemp.createTempSync('fess_pos_db_'));
  tearDown(() => dir.deleteSync(recursive: true));

  test('plain SQLite is refused before anything is written', () {
    final db = sqlite3.open('${dir.path}/plain.db');
    addTearDown(db.dispose);
    expect(
      () => requireSqlCipher(db),
      throwsPosCode(PosErrorCodes.localStoreNotEncrypted),
    );
    expect(
      () => configureEncryptedDatabase(db, 'ab' * 32),
      throwsPosCode(PosErrorCodes.localStoreNotEncrypted),
    );
    expect(db.select('SELECT name FROM sqlite_master'), isEmpty);
  });

  test('WAL, synchronous=FULL and foreign keys are applied and verified', () {
    final db = sqlite3.open('${dir.path}/durable.db');
    addTearDown(db.dispose);
    applyDurabilityPragmas(db);
    expect(db.select('PRAGMA journal_mode').first.columnAt(0), 'wal');
    expect(db.select('PRAGMA synchronous').first.columnAt(0), 2);
    expect(db.select('PRAGMA foreign_keys').first.columnAt(0), 1);
  });

  test('a store that cannot use WAL is refused, not used as it is', () {
    final db = sqlite3.openInMemory(); // in-memory databases can't do WAL
    addTearDown(db.dispose);
    expect(
      () => applyDurabilityPragmas(db),
      throwsPosCode(PosErrorCodes.localStoreUnavailable),
    );
  });
}
