import 'dart:math';

import 'package:fess_pos/src/contract/errors.dart';
import 'package:fess_pos/src/platform/secure_store.dart';

/// Where the database key lives in the secure store. Versioned: a new key
/// scheme gets a new name, never an overwrite of this one.
const String databaseKeyName = 'db_key.v1';

final RegExp _hexKey = RegExp(r'^[0-9a-f]{64}$');

/// The key of the local database: 32 random bytes as hex, kept in secure
/// storage (docs/03 §7).
///
/// This protects captured data, so it is deliberately strict (docs/12 §1):
/// - a new key is made only when there is no key **and** no database;
/// - a database whose key is missing, or can't be read right now (a locked
///   Keychain before first unlock, a Keystore glitch), is never re-keyed,
///   replaced or deleted. Opening fails closed and the file stays, because
///   the key may come back and the data may not be synced yet;
/// - a new key is read back before use, so no database is ever created with
///   a key that wasn't stored.
Future<String> resolveDatabaseKey({
  required SecureStore store,
  required bool databaseExists,
  Random? random,
}) async {
  final String? stored;
  try {
    stored = await store.read(databaseKeyName);
  } on Object catch (e) {
    throw PosException(
      PosErrorCodes.localStoreKeyUnreadable,
      'the database key could not be read; nothing was changed',
      kind: PosErrorKind.localStore,
      retryable: true,
      cause: e,
    );
  }
  if (stored != null) {
    if (!_hexKey.hasMatch(stored)) {
      throw const PosException(
        PosErrorCodes.localStoreKeyRejected,
        'the stored database key is malformed; nothing was changed',
        kind: PosErrorKind.localStore,
        retryable: false,
      );
    }
    return stored;
  }
  if (databaseExists) {
    throw const PosException(
      PosErrorCodes.localStoreKeyMissing,
      'the local database exists but its key is missing; the database is '
      'kept, not replaced',
      kind: PosErrorKind.localStore,
      retryable: false,
    );
  }
  final rng = random ?? Random.secure();
  final fresh = List.generate(
    32,
    (_) => rng.nextInt(256).toRadixString(16).padLeft(2, '0'),
  ).join();
  try {
    await store.write(databaseKeyName, fresh);
    if (await store.read(databaseKeyName) != fresh) {
      throw StateError('the key read back differs from the key written');
    }
  } on Object catch (e) {
    throw PosException(
      PosErrorCodes.localStoreKeyUnreadable,
      'a new database key could not be stored; no database was created',
      kind: PosErrorKind.localStore,
      retryable: true,
      cause: e,
    );
  }
  return fresh;
}
