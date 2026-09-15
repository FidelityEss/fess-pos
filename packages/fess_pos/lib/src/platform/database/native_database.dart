import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:drift/native.dart';
import 'package:fess_pos/src/contract/errors.dart';
import 'package:fess_pos/src/core/logging/pos_logger.dart';
import 'package:fess_pos/src/platform/database/key_policy.dart';
import 'package:fess_pos/src/platform/database/local_executor.dart';
import 'package:fess_pos/src/platform/module_storage.dart';
import 'package:fess_pos/src/platform/secure_store.dart';
import 'package:flutter/foundation.dart';
import 'package:path/path.dart' as p;
import 'package:sqlcipher_flutter_libs/sqlcipher_flutter_libs.dart';
import 'package:sqlite3/open.dart';
import 'package:sqlite3/sqlite3.dart';

const String databaseFileName = 'fess_pos.db';

/// Where stores that can never be opened again are kept (D-52).
const String quarantineFolder = 'quarantine';

/// Native builds encrypt the store with SQLCipher.
const bool localStoreEncrypted = true;

const PosLogger _log = PosLogger('local_store');

/// The encrypted store, in the module's own folder, served by drift from a
/// background isolate (docs/03 §8).
Future<LocalExecutor> openLocalExecutor({
  required SecureStore secureStore,
  required ModuleStorage storage,
  Random? random,
}) async {
  final dir = await storage.moduleDirectory();
  if (dir == null) {
    throw const PosException(
      PosErrorCodes.localStoreUnavailable,
      'there is no directory for the local database',
      kind: PosErrorKind.localStore,
      retryable: false,
    );
  }
  final file = File(p.join(dir, databaseFileName));
  final quarantined = <String>[];
  String key;
  try {
    key = await resolveDatabaseKey(
      store: secureStore,
      databaseExists: file.existsSync(),
      random: random,
    );
  } on PosException catch (e) {
    if (e.code != PosErrorCodes.localStoreKeyMissing &&
        e.code != PosErrorCodes.localStoreKeyRejected) {
      rethrow;
    }
    // The store can never be opened again: its key is gone for good (the
    // files came back from a backup on another phone, or the key was lost)
    // or is corrupt. Keep it, intact, out of the way, and start a new store
    // so the module keeps working.
    quarantined.add(await quarantineLocalDatabase(dir, reason: e.code));
    key = await resolveDatabaseKey(
      store: secureStore,
      databaseExists: false,
      random: random,
    );
  }
  if (defaultTargetPlatform == TargetPlatform.android) {
    // Loads libsqlcipher through Java on old Android versions, where
    // loading it straight from Dart fails. Process-wide, but it only loads a
    // library; it changes no Dart global.
    await applyWorkaroundToOpenSqlCipherOnOldAndroidVersions();
  }
  return LocalExecutor(
    NativeDatabase.createInBackground(
      file,
      isolateSetup: useSqlCipher,
      setup: (db) => configureEncryptedDatabase(db, key),
    ),
    quarantined: quarantined,
  );
}

/// Moves the store's files (`.db`, `-wal`, `-shm`) together into
/// `quarantine/`, intact, and returns the name they now share. Nothing is
/// ever deleted: the data stays on the device, for recovery if the key ever
/// turns up, and the move is recorded and reported.
Future<String> quarantineLocalDatabase(
  String dir, {
  required String reason,
}) async {
  final stamp = DateTime.now().toUtc().toIso8601String().replaceAll(
    RegExp('[:.]'),
    '-',
  );
  final name = 'fess_pos-$stamp';
  final target = Directory(p.join(dir, quarantineFolder))
    ..createSync(recursive: true);
  for (final suffix in ['', '-wal', '-shm']) {
    final source = File(p.join(dir, '$databaseFileName$suffix'));
    if (source.existsSync()) {
      source.renameSync(p.join(target.path, '$name.db$suffix'));
    }
  }
  // Beside it: the note of unsent work as it stood, and why it was moved,
  // so it can be reported honestly (T5-13, D-93).
  final note = File(p.join(dir, 'custody.json'));
  if (note.existsSync()) {
    note.renameSync(p.join(target.path, '$name.custody.json'));
  }
  File(p.join(target.path, '$name.json')).writeAsStringSync(
    jsonEncode({
      'reason': reason,
      'at': DateTime.now().toUtc().toIso8601String(),
    }),
  );
  _log.warning('local store moved aside as $name ($reason); a new one starts');
  return name;
}

/// Runs in drift's database isolate: SQLCipher replaces the system SQLite
/// there, and only there, so nothing in the host's isolate changes. On iOS
/// SQLCipher is linked into the app by its pod; nothing is overridden, and
/// [requireSqlCipher] proves it is really the library in use.
void useSqlCipher() {
  open.overrideFor(OperatingSystem.android, openCipherOnAndroid);
}

/// Prepares a connection to the encrypted store. Throws [PosException], and
/// writes nothing, when the store isn't really encrypted or the key is
/// wrong.
void configureEncryptedDatabase(Database db, String hexKey) {
  requireSqlCipher(db);
  db.execute('PRAGMA key = "x\'$hexKey\'";');
  try {
    // A wrong key fails on the first read, with SQLITE_NOTADB.
    db.select('SELECT count(*) FROM sqlite_master;');
  } on SqliteException catch (e) {
    throw PosException(
      PosErrorCodes.localStoreKeyRejected,
      'the database key does not open the local store; the file is kept',
      kind: PosErrorKind.localStore,
      retryable: false,
      cause: e.toString(),
    );
  }
  applyDurabilityPragmas(db);
}

/// Fails closed unless SQLCipher is the SQLite library in use. On iOS the
/// system SQLite can shadow SQLCipher and silently leave the file
/// unencrypted (findings/03 §2, docs/03 §7).
void requireSqlCipher(Database db) {
  final rows = db.select('PRAGMA cipher_version;');
  final version = rows.isEmpty ? null : rows.first.columnAt(0);
  if (version is! String || version.isEmpty) {
    throw const PosException(
      PosErrorCodes.localStoreNotEncrypted,
      'SQLCipher is not active: refusing to store anything unencrypted',
      kind: PosErrorKind.localStore,
      retryable: false,
    );
  }
}

/// WAL, `synchronous=FULL` and foreign keys (docs/12 §3), verified rather
/// than assumed.
void applyDurabilityPragmas(Database db) {
  final mode = db.select('PRAGMA journal_mode = WAL;').first.columnAt(0);
  if (mode is! String || mode.toLowerCase() != 'wal') {
    throw PosException(
      PosErrorCodes.localStoreUnavailable,
      'could not switch the local store to WAL (journal_mode = $mode)',
      kind: PosErrorKind.localStore,
      retryable: false,
    );
  }
  db.execute('PRAGMA synchronous = FULL;');
  final synchronous = db.select('PRAGMA synchronous;').first.columnAt(0);
  if (synchronous != 2) {
    throw PosException(
      PosErrorCodes.localStoreUnavailable,
      'could not set synchronous = FULL (got $synchronous)',
      kind: PosErrorKind.localStore,
      retryable: false,
    );
  }
  db.execute('PRAGMA foreign_keys = ON;');
}
