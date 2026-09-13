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

/// Sync machinery: pull cursors, `server_epoch`, the clock offset
/// (docs/08 §1–2). Filled by the pull engine (T1-23).
@DataClassName('SyncStateRow')
class SyncState extends Table {
  TextColumn get key => text()();

  TextColumn get value => text()();

  /// ISO-8601 with the device's offset (docs/12 §11).
  TextColumn get updatedAt => text()();

  @override
  Set<Column<Object>> get primaryKey => {key};
}
