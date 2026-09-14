import 'dart:math';

import 'package:drift/wasm.dart';
import 'package:fess_pos/src/core/logging/pos_logger.dart';
import 'package:fess_pos/src/platform/database/local_executor.dart';
import 'package:fess_pos/src/platform/module_storage.dart';
import 'package:fess_pos/src/platform/secure_store.dart';

/// The web store isn't encrypted (D-51): sqlite3 2.x has no encrypted WASM
/// build. Web records carry `client_type = web`, and the web client is
/// deferred (docs/13 §8).
const bool localStoreEncrypted = false;

const PosLogger _log = PosLogger('local_store');

/// sqlite3 WASM in the browser's storage (OPFS, or IndexedDB where OPFS is
/// missing). The web build serves `sqlite3.wasm` and `drift_worker.js`
/// next to `index.html` (T3-24).
Future<LocalExecutor> openLocalExecutor({
  required SecureStore secureStore,
  required ModuleStorage storage,
  Random? random,
}) async {
  final result = await WasmDatabase.open(
    databaseName: 'fess_pos',
    sqlite3Uri: Uri.parse('sqlite3.wasm'),
    driftWorkerUri: Uri.parse('drift_worker.js'),
  );
  if (result.missingFeatures.isNotEmpty) {
    _log.warning(
      'web store uses ${result.chosenImplementation.name}; the browser lacks '
      '${result.missingFeatures.map((f) => f.name).join(', ')}',
    );
  }
  return LocalExecutor(result.resolvedExecutor);
}

/// The web store has no key, so it never needs moving aside.
Future<String> quarantineLocalDatabase(
  String dir, {
  required String reason,
}) => Future.error(UnsupportedError('the web store has no key to lose'));
