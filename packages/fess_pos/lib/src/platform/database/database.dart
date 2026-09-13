/// Opening the local database: SQLCipher on native, sqlite3 WASM on the web.
/// Both export `openLocalExecutor` and `localStoreEncrypted`.
library;

export 'key_policy.dart';
export 'native_database.dart' if (dart.library.js_interop) 'web_database.dart';
