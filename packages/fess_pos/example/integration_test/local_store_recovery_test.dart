// On a device or emulator (T1-42, D-52): the store lives out of Android
// backups, and a store whose key is lost or wrong is moved aside intact
// while a new one starts, so the module keeps working.
//
//   flutter test integration_test/local_store_recovery_test.dart -d <device>
//
// ignore_for_file: implementation_imports

import 'dart:io';

import 'package:fess_pos/src/data/local/local_store.dart';
import 'package:fess_pos/src/platform/database/key_policy.dart';
import 'package:fess_pos/src/platform/platform_services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('out of backups; a lost or wrong key never leaves it stuck', (
    tester,
  ) async {
    final platform = PlatformServices.forCurrentPlatform();
    final dir = (await platform.storage.moduleDirectory())!;
    if (Platform.isAndroid) expect(dir, endsWith('/no_backup/fess_pos'));

    Future<int> quarantinedFiles() async {
      final q = Directory('$dir/quarantine');
      if (!q.existsSync()) return 0;
      return q.listSync().where((f) => f.path.endsWith('.db')).length;
    }

    final before = await quarantinedFiles();

    var db = await openLocalStore(platform);
    await db.customStatement(
      'INSERT OR REPLACE INTO sync_state (key, value, updated_at) '
      "VALUES ('probe', 'old', '2026-09-13T12:00:00.000+02:00')",
    );
    await db.close();

    // The key disappears, as when the files come back on another phone.
    await platform.secureStore.delete(databaseKeyName);
    db = await openLocalStore(platform);
    expect(
      await db
          .customSelect("SELECT value FROM sync_state WHERE key = 'probe'")
          .get(),
      isEmpty,
      reason: 'a new store started',
    );
    final log = await db
        .customSelect(
          "SELECT value FROM module_meta WHERE key = 'quarantined_stores'",
        )
        .getSingle();
    expect(log.data['value'], contains('fess_pos-'));
    await db.close();
    expect(await quarantinedFiles(), before + 1);

    // A key that doesn't open the store (a damaged or foreign file).
    await platform.secureStore.write(databaseKeyName, 'ab' * 32);
    db = await openLocalStore(platform);
    await db.customSelect('SELECT 1').get();
    await db.close();
    expect(await quarantinedFiles(), before + 2);
  });
}
