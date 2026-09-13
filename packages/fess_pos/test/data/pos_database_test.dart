@TestOn('vm')
library;

import 'dart:io';

import 'package:drift/native.dart';
import 'package:fess_pos/fess_pos.dart';
import 'package:fess_pos/src/core/version.dart';
import 'package:fess_pos/src/data/local/local_store.dart';
import 'package:fess_pos/src/data/local/pos_database.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqlite3/sqlite3.dart';

void main() {
  test(
    'schema 1 records when, and by which module, the store was made',
    () async {
      final db = PosDatabase(NativeDatabase.memory());
      addTearDown(db.close);
      final meta = {
        for (final row in await db.select(db.moduleMeta).get())
          row.key: row.value,
      };
      expect(meta[MetaKeys.createdByModule], PosVersions.module);
      expect(
        meta[MetaKeys.createdAt],
        matches(
          RegExp(
            r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$',
          ),
        ),
      );
      expect(await db.select(db.syncState).get(), isEmpty);
      expect(db.schemaVersion, PosDatabase.currentSchemaVersion);
    },
  );

  test(
    'a store written by a newer module is refused, never migrated down',
    () async {
      final dir = Directory.systemTemp.createTempSync('fess_pos_schema_');
      addTearDown(() => dir.deleteSync(recursive: true));
      final path = '${dir.path}/newer.db';
      sqlite3.open(path)
        ..execute('CREATE TABLE future_table (x TEXT);')
        ..execute("INSERT INTO future_table VALUES ('kept');")
        ..execute('PRAGMA user_version = 7;')
        ..dispose();

      final db = PosDatabase(NativeDatabase(File(path)));
      Object? error;
      try {
        await db.customSelect('SELECT 1').get();
      } on Object catch (e) {
        error = e;
      }
      await db.close();
      expect(error, isNotNull);
      expect(
        localStoreFailure(error!).code,
        PosErrorCodes.localStoreSchemaNewer,
      );

      final raw = sqlite3.open(path);
      addTearDown(raw.dispose);
      expect(
        raw.select('SELECT x FROM future_table').single.columnAt(0),
        'kept',
      );
      expect(raw.select('PRAGMA user_version').single.columnAt(0), 7);
    },
  );
}
