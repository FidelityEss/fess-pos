import 'dart:convert';

import 'package:drift/drift.dart';
import 'package:fess_pos/src/contract/errors.dart';
import 'package:fess_pos/src/core/time/device_time.dart';
import 'package:fess_pos/src/core/version.dart';
import 'package:fess_pos/src/data/local/pos_database.steps.dart';
import 'package:fess_pos/src/data/local/tables.dart';

part 'pos_database.g.dart';

/// The module's local store (docs/08 §1). How it is opened — the key, the
/// encryption check, WAL with `synchronous=FULL` — lives in
/// `platform/database/`; this class is the schema and its migrations.
///
/// Changing the schema: bump [currentSchemaVersion], add the step to
/// [migration], run `dart run drift_dev make-migrations` (it writes the
/// schema dump in `drift_schemas/` and a migration test), and never change a
/// version that has shipped. Tables arrive with their tasks: the outbox and
/// cached server documents (schema 2, T1-22/T1-23), jobs, reviews and
/// definitions (schema 3, T2-14), the map tile index (schema 4, T2-17),
/// inspections and evidence (schema 5, T4-27), full drafts (T3-06).
@DriftDatabase(
  tables: [
    ModuleMeta,
    SyncState,
    Outbox,
    CachedDocuments,
    Jobs,
    Reviews,
    DefinitionVersions,
    ActiveDefinitions,
    TileCacheIndex,
    Inspections,
    Evidence,
  ],
)
class PosDatabase extends _$PosDatabase {
  PosDatabase(super.e);

  static const int currentSchemaVersion = 5;

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
      // Steps from `dart run drift_dev make-migrations`; each is checked
      // against the schema dumps by test/drift/.
      await stepByStep(
        from1To2: (m, schema) async {
          await m.createTable(schema.outbox);
          await m.createTable(schema.cachedDocuments);
        },
        from2To3: (m, schema) async {
          await m.createTable(schema.jobs);
          await m.createTable(schema.reviews);
          await m.createTable(schema.definitionVersions);
          await m.createTable(schema.activeDefinitions);
        },
        from3To4: (m, schema) async {
          await m.createTable(schema.tileCacheIndex);
        },
        from4To5: (m, schema) async {
          await m.createTable(schema.inspections);
          await m.createTable(schema.evidence);
        },
      )(m, from, to);
    },
    beforeOpen: (details) async {
      final before = details.versionBefore;
      if (before != null) _refuseDowngrade(before, details.versionNow);
      await customStatement('PRAGMA foreign_keys = ON');
      // An item the app was sending when it stopped goes back to queued and
      // is sent again, same id and bytes; landing is idempotent (docs/12 §3).
      await (update(outbox)..where((o) => o.state.equals('in_flight'))).write(
        const OutboxCompanion(state: Value('queued')),
      );
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

  /// Evidence ids already reported as lost (JSON list), so each is reported
  /// once (docs/12 §3).
  static const String evidenceAnomaliesReported = 'evidence_anomalies_reported';

  /// JSON list of `{name, at}`: stores moved into `quarantine/` (D-52).
  static const String quarantinedStores = 'quarantined_stores';

  /// How many of [quarantinedStores] have gone out in a `client_error`.
  static const String quarantinedStoresReported = 'quarantined_stores_reported';

  /// Set while an inspection is paused because the agent left the fence
  /// (T4-07); its value is when.
  static String geofencePaused(String inspectionId) =>
      'geofence_paused.$inspectionId';

  /// A job's check-in on arrival (T4-23): the fix, as `geofence_result`
  /// carries one.
  static String checkin(String jobId) => 'checkin.$jobId';

  /// An inspection's breadcrumbs waiting to go, and how many batches went
  /// (T4-08).
  static String traces(String inspectionId) => 'traces.$inspectionId';
}

extension QuarantineLog on PosDatabase {
  /// Records stores moved aside because they could never be opened again
  /// (D-52), for the sync layer to report (T1-22).
  Future<void> recordQuarantine(List<String> names) async {
    final now = isoWithOffset(DateTime.now());
    final existing =
        await (select(
              moduleMeta,
            )..where((m) => m.key.equals(MetaKeys.quarantinedStores)))
            .getSingleOrNull();
    final log = <Object?>[
      if (existing != null) ...(jsonDecode(existing.value) as List<Object?>),
      ...names.map((n) => {'name': n, 'at': now}),
    ];
    await into(moduleMeta).insertOnConflictUpdate(
      ModuleMetaCompanion.insert(
        key: MetaKeys.quarantinedStores,
        value: jsonEncode(log),
        updatedAt: now,
      ),
    );
  }
}
