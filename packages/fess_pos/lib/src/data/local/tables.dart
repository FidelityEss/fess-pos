import 'package:drift/drift.dart';

/// Facts about this installation of the module's store: when it was created
/// and by which module version. One row per fact.
@DataClassName('ModuleMetaRow')
class ModuleMeta extends Table {
  TextColumn get key => text()();

  TextColumn get value => text()();

  /// ISO-8601 with the device's offset (docs/12 §11).
  TextColumn get updatedAt => text()();

  @override
  Set<Column<Object>> get primaryKey => {key};
}

/// The transactional outbox (docs/08 §3, docs/12 §3–4): one row per
/// envelope, written with the change it records, sent until a receipt says
/// the server holds it. Rows leave only by `OutboxStore.purgeCommitted`.
@DataClassName('OutboxRow')
class Outbox extends Table {
  /// The envelope id: UUIDv7, the server's idempotency key.
  TextColumn get id => text()();

  /// The per-device counter, one per envelope (docs/12 §15).
  IntColumn get deviceSeq => integer().unique()();

  TextColumn get type => text()();

  IntColumn get typeVersion => integer()();

  /// The send lane, 1–4 (docs/08 §3).
  IntColumn get lane => integer()();

  /// The user whose session sends it; null for device reports, which go
  /// with whoever is signed in.
  TextColumn get userId => text().nullable()();

  /// The envelope exactly as it is sent, fixed when the action happened.
  TextColumn get envelope => text()();

  TextColumn get payloadHash => text()();

  IntColumn get bytes => integer()();

  /// `queued`, `in_flight`, `durable`, `committed` or `needs_attention`
  /// (docs/08 §1).
  TextColumn get state => text()();

  /// The last receipt's state, or `refused` / `parked`.
  TextColumn get receiptState => text().nullable()();

  /// The last receipt, as received.
  TextColumn get receipt => text().nullable()();

  TextColumn get lastError => text().nullable()();

  IntColumn get attempts => integer().withDefault(const Constant(0))();

  /// Not before this time (epoch ms); null means as soon as possible.
  IntColumn get nextAttemptMs => integer().nullable()();

  /// The record it is about, e.g. `job:<id>`, for the sync screens.
  TextColumn get entityRef => text().nullable()();

  /// ISO-8601 with the device's offset (docs/12 §11).
  TextColumn get createdAt => text()();

  IntColumn get createdAtMs => integer()();

  TextColumn get updatedAt => text()();

  /// When a receipt or the pull said committed (epoch ms). Retention counts
  /// from here (docs/08 §4).
  IntColumn get committedAtMs => integer().nullable()();

  @override
  Set<Column<Object>> get primaryKey => {id};
}

/// Server documents the module keeps whole (docs/08 §2): the resolved
/// remote config (one per context), `me`, the home-tile totals, the reason
/// codes and the agent card. One row per document.
@DataClassName('CachedDocumentRow')
class CachedDocuments extends Table {
  TextColumn get key => text()();

  /// The document as JSON.
  TextColumn get body => text()();

  /// The server's hash or version id for it, when it has one.
  TextColumn get hash => text().nullable()();

  /// ISO-8601 with the device's offset (docs/12 §11).
  TextColumn get updatedAt => text()();

  @override
  Set<Column<Object>> get primaryKey => {key};
}

/// Sync machinery: pull cursors, `server_epoch`, the clock offset
/// (docs/08 §1–2) and the last `device_seq`.
@DataClassName('SyncStateRow')
class SyncState extends Table {
  TextColumn get key => text()();

  TextColumn get value => text()();

  /// ISO-8601 with the device's offset (docs/12 §11).
  TextColumn get updatedAt => text()();

  @override
  Set<Column<Object>> get primaryKey => {key};
}
