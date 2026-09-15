import 'package:fess_pos/src/bootstrap/bootstrap_cache.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// The module's secrets: the database key, the refresh token, session tokens
/// and the bootstrap cache (docs/03 §7).
abstract interface class SecureStore {
  Future<String?> read(String key);

  Future<void> write(String key, String value);

  Future<void> delete(String key);

  /// Deletes every entry the module stored, and nothing of the host's. Used
  /// only when the store can't be read and there's no local database, so no
  /// captured data depends on what is deleted (D-52).
  Future<void> reset();
}

/// Prefix on every key the module stores, so it can't collide with a host's.
const String secureKeyPrefix = 'fess_pos.';

/// Android Keystore and iOS Keychain, through flutter_secure_storage.
///
/// The module's items live apart from the host's: in their own
/// shared-preferences file on Android, under their own Keychain service on
/// iOS, under their own prefix on the web. FESS keeps `persistent_device_id`
/// in the default store, which the module never reads, writes or wipes
/// (findings/03 §2).
///
/// These options are part of the storage contract: changing them orphans
/// every stored value, including the database key. Change them only
/// together with a migration.
class FlutterSecureStore implements SecureStore {
  /// Always with the module's own options: [reset] relies on them to stay
  /// inside the module's namespace, so there is no way to pass others.
  FlutterSecureStore()
    : _storage = const FlutterSecureStorage(
        aOptions: androidOptions,
        iOptions: iosOptions,
        webOptions: webOptions,
      );

  static const AndroidOptions androidOptions = AndroidOptions(
    sharedPreferencesName: 'fess_pos_secure_store',
    preferencesKeyPrefix: 'fess_pos_',
    // Stated explicitly: never wipe the store on a decryption error. That
    // would destroy the database key, and with it every unsynced record.
    // The module decides when a reset is safe (D-52).
    // ignore: avoid_redundant_argument_values
    resetOnError: false,
  );

  static const IOSOptions iosOptions = IOSOptions(
    accountName: 'fess_pos',
    // Readable by background sync once the phone has been unlocked after a
    // restart, and never restored onto another device.
    accessibility: KeychainAccessibility.first_unlock_this_device,
  );

  static const WebOptions webOptions = WebOptions(
    dbName: 'fess_pos',
    publicKey: 'fess_pos',
  );

  final FlutterSecureStorage _storage;

  @override
  Future<String?> read(String key) =>
      _storage.read(key: '$secureKeyPrefix$key');

  @override
  Future<void> write(String key, String value) =>
      _storage.write(key: '$secureKeyPrefix$key', value: value);

  @override
  Future<void> delete(String key) =>
      _storage.delete(key: '$secureKeyPrefix$key');

  /// Scoped by the options above: the module's own Android preferences
  /// file, its own Keychain service, its own web namespace.
  @override
  Future<void> reset() => _storage.deleteAll();
}

/// Keeps secrets in memory only: tests.
class MemorySecureStore implements SecureStore {
  final Map<String, String> values = {};

  @override
  Future<String?> read(String key) async => values[key];

  @override
  Future<void> write(String key, String value) async => values[key] = value;

  @override
  Future<void> delete(String key) async => values.remove(key);

  @override
  Future<void> reset() async => values.clear();
}

/// The bootstrap snapshot in secure storage: readable before anything else
/// starts, in a background isolate too.
class SecureStoreBootstrapCache implements BootstrapCache {
  const SecureStoreBootstrapCache(this._store);

  static const String key = 'bootstrap_snapshot.v1';

  final SecureStore _store;

  @override
  Future<String?> read() => _store.read(key);

  @override
  Future<void> write(String snapshotJson) => _store.write(key, snapshotJson);
}
