import 'package:drift/drift.dart';
import 'package:fess_pos/src/contract/errors.dart';
import 'package:fess_pos/src/core/time/device_time.dart';
import 'package:fess_pos/src/core/version.dart';
import 'package:fess_pos/src/data/local/tables.dart';

part 'pos_database.g.dart';

/// The module's local store (docs/08 §1). How it is opened — the key, the
/// encryption check, WAL with `synchronous=FULL` — lives in
/// `platform/database/`; this class is the schema and its migrations.
///
/// Changing the schema: bump [currentSchemaVersion], add the step to
/// [migration], run `dart run drift_dev make-migrations` (it writes the
/// schema dump in `drift_schemas/` and a migration test), and never change a
/// version that has shipped. Until the module's first release, version 1 may
/// still change. Tables arrive with their tasks: the outbox and receipts
/// (T1-22), definitions and remote config (T1-23), drafts (T3-06), evidence
/// (T4-03).
@DriftDatabase(tables: [ModuleMeta, SyncState])
class PosDatabase extends _$PosDatabase {
  PosDatabase(super.e);

  static const int currentSchemaVersion = 1;

  @override
  int get schemaVersion => currentSchemaVersion;

  @override
  MigrationStrategy get migration => MigrationStrategy(
    onCreate: (m) async {
      await m.createAll();
      final now = isoWithOffset(DateTime.now());
      await batch(
        (b) => b.insertAll(moduleMeta, [
          ModuleMetaCompanion.insert(
            key: MetaKeys.createdAt,
            value: now,
            updatedAt: now,
          ),
          ModuleMetaCompanion.insert(
            key: MetaKeys.createdByModule,
            value: PosVersions.module,
            updatedAt: now,
          ),
        ]),
      );
    },
    onUpgrade: (m, from, to) async {
      _refuseDowngrade(from, to);
      // Schema 1 is the first; later versions add their steps here.
      throw PosException(
        PosErrorCodes.localStoreUnavailable,
        'no migration from local schema $from to $to',
        kind: PosErrorKind.localStore,
        retryable: false,
      );
    },
    beforeOpen: (details) async {
      final before = details.versionBefore;
      if (before != null) _refuseDowngrade(before, details.versionNow);
      await customStatement('PRAGMA foreign_keys = ON');
    },
  );

  /// A newer module wrote this store and the app was downgraded. Migrating
  /// "down" could lose data, so the store is refused and the file kept.
  static void _refuseDowngrade(int from, int to) {
    if (from > to) {
      throw PosException(
        PosErrorCodes.localStoreSchemaNewer,
        'the local store has schema $from; this module understands up to $to',
        kind: PosErrorKind.localStore,
        retryable: false,
      );
    }
  }
}

abstract final class MetaKeys {
  static const String createdAt = 'store_created_at';
  static const String createdByModule = 'store_created_by_module';
}
