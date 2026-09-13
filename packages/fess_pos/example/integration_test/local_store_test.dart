// On a device or emulator: the module's local store is really encrypted
// with SQLCipher, durable, and reopens with the key it stored (T1-20).
//
//   flutter test integration_test/local_store_test.dart -d <device>
//
// It reaches into the module's internals on purpose: this checks the
// storage layer itself, below the public API.
// ignore_for_file: implementation_imports

import 'dart:io';

import 'package:fess_pos/src/data/local/local_store.dart';
import 'package:fess_pos/src/platform/platform_services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('the local store is SQLCipher-encrypted, durable, and reopens', (
    tester,
  ) async {
    final platform = PlatformServices.forCurrentPlatform();

    final db = await openLocalStore(platform);
    Future<Object?> pragma(String name) async =>
        (await db.customSelect('PRAGMA $name').getSingle()).data.values.first;

    final cipher = await pragma('cipher_version');
    expect(cipher, isA<String>());
    expect(cipher! as String, isNotEmpty);
    expect(await pragma('journal_mode'), 'wal');
    expect(await pragma('synchronous'), 2);

    await db.customStatement(
      'INSERT OR REPLACE INTO sync_state (key, value, updated_at) '
      "VALUES ('probe', 'kept', '2026-09-13T12:00:00.000+02:00')",
    );
    await db.close();

    // A plain SQLite file starts with the text "SQLite format 3"; an
    // encrypted SQLCipher file starts with random bytes.
    final dir = await platform.storage.moduleDirectory();
    final raf = File('$dir/fess_pos.db').openSync();
    final header = String.fromCharCodes(raf.readSync(16));
    raf.closeSync();
    expect(header.startsWith('SQLite format 3'), isFalse);

    final again = await openLocalStore(platform);
    final row = await again
        .customSelect("SELECT value FROM sync_state WHERE key = 'probe'")
        .getSingle();
    expect(row.data['value'], 'kept');
    await again.close();
  });
}
