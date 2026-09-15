import 'dart:math';

import 'package:fess_pos/src/contract/errors.dart';
import 'package:fess_pos/src/platform/secure_store.dart';

/// Where the database key lives in the secure store. Versioned: a new key
/// scheme gets a new name, never an overwrite of this one.
const String databaseKeyName = 'db_key.v1';

final RegExp _hexKey = RegExp(r'^[0-9a-f]{64}$');

/// The key of the local database: 32 random bytes as hex, kept in secure
/// storage (docs/03 §7). The rules (D-52):
///
/// - **A database exists:** its stored key is returned. If the key can't be
///   read right now (a locked Keychain before first unlock, a Keystore
///   glitch), opening fails closed with `LOCAL_STORE_KEY_UNREADABLE` and is
///   retried later: nothing is changed, because the key may come back. If
///   the key is gone for good (`LOCAL_STORE_KEY_MISSING`) or malformed
///   (`LOCAL_STORE_KEY_REJECTED`), the caller moves the database aside
///   intact and starts a new one.
/// - **No database:** nothing is encrypted with any key, so a usable key is
///   made whatever the store holds: the stored one if it's valid, otherwise
///   a new one. A store that can't be read at all (typically one restored
///   from a backup that this phone's Keystore can't decrypt) is reset first;
///   the reset touches only the module's own entries.
/// - A new key is read back before use, so no database is ever created with
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
    if (databaseExists) {
      throw PosException(
        PosErrorCodes.localStoreKeyUnreadable,
        'the database key could not be read; nothing was changed',
        kind: PosErrorKind.localStore,
        retryable: true,
        cause: e,
      );
    }
    try {
      await store.reset();
    } on Object catch (resetError) {
      throw PosException(
        PosErrorCodes.localStoreKeyUnreadable,
        'the secure store could not be read or reset; no database was created',
        kind: PosErrorKind.localStore,
        retryable: true,
        cause: resetError,
      );
    }
    return _newKey(store, random);
  }
  if (stored != null && _hexKey.hasMatch(stored)) return stored;
  if (databaseExists) {
    throw stored == null
        ? const PosException(
            PosErrorCodes.localStoreKeyMissing,
            'the local database exists but its key is gone',
            kind: PosErrorKind.localStore,
            retryable: false,
          )
        : const PosException(
            PosErrorCodes.localStoreKeyRejected,
            'the stored database key is malformed',
            kind: PosErrorKind.localStore,
            retryable: false,
          );
  }
  return _newKey(store, random);
}

Future<String> _newKey(SecureStore store, Random? random) async {
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
