import 'package:fess_pos/src/contract/errors.dart';
import 'package:fess_pos/src/data/local/custody_note.dart';
import 'package:fess_pos/src/data/local/pos_database.dart';
import 'package:fess_pos/src/platform/database/database.dart';
import 'package:fess_pos/src/platform/platform_services.dart';

/// Opens the local store and proves it's usable before anything writes to
/// it: the right key, really encrypted, durable settings, a schema this
/// module understands (docs/08 §1, docs/12 §3).
///
/// Nothing is ever deleted (D-52). A store whose key doesn't open it (a
/// damaged file, or one from another install) is moved aside intact and a
/// new store started, once; every move is recorded in `module_meta` for the
/// sync layer to report (T1-22). Other failures fail closed as a
/// [PosException], and the file stays.
Future<PosDatabase> openLocalStore(PlatformServices platform) async {
  try {
    return await _open(platform);
  } on PosException catch (e) {
    if (e.code != PosErrorCodes.localStoreKeyRejected) rethrow;
    final dir = await platform.storage.moduleDirectory();
    if (dir == null) rethrow;
    final name = await quarantineLocalDatabase(dir, reason: e.code);
    return _open(platform, alreadyQuarantined: [name]);
  }
}

Future<PosDatabase> _open(
  PlatformServices platform, {
  List<String> alreadyQuarantined = const [],
}) async {
  final opened = await openLocalExecutor(
    secureStore: platform.secureStore,
    storage: platform.storage,
  );
  final db = PosDatabase(opened.executor);
  try {
    // Opening is lazy; this runs the key, cipher and pragma checks and the
    // migrations now instead of on the first real write.
    await db.customSelect('SELECT 1').get();
  } on Object catch (e, st) {
    try {
      await db.close();
    } on Object {
      // Closing a store that never opened can fail too; the cause matters.
    }
    Error.throwWithStackTrace(localStoreFailure(e), st);
  }
  final quarantined = [...alreadyQuarantined, ...opened.quarantined];
  if (quarantined.isNotEmpty) {
    // With why each was moved and the note of unsent work kept beside it,
    // so it's reported honestly (T5-13).
    final dir = await platform.storage.moduleDirectory();
    await db.recordQuarantine(
      quarantined,
      details: dir == null
          ? const {}
          : await readQuarantineDetails(dir, quarantined),
    );
  }
  return db;
}

const List<String> _localStoreCodes = [
  PosErrorCodes.localStoreNotEncrypted,
  PosErrorCodes.localStoreKeyMissing,
  PosErrorCodes.localStoreKeyUnreadable,
  PosErrorCodes.localStoreKeyRejected,
  PosErrorCodes.localStoreSchemaNewer,
  PosErrorCodes.localStoreUnavailable,
];

/// The [PosException] behind a local-store failure. One that crossed
/// drift's database isolate arrives wrapped, and its text still carries the
/// code, which is all the recovery needs.
PosException localStoreFailure(Object error) {
  if (error is PosException) return error;
  final text = error.toString();
  for (final code in _localStoreCodes) {
    if (text.contains(code)) {
      return PosException(
        code,
        text,
        kind: PosErrorKind.localStore,
        retryable: code == PosErrorCodes.localStoreKeyUnreadable,
        cause: error,
      );
    }
  }
  return PosException(
    PosErrorCodes.localStoreUnavailable,
    'the local store could not be opened',
    kind: PosErrorKind.localStore,
    retryable: true,
    cause: error,
  );
}
