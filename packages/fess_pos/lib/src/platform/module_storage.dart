import 'package:fess_pos/src/platform/io/files.dart';
import 'package:flutter/foundation.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

/// Where the module keeps its files (the database, encrypted evidence): its
/// own folder in the app's private storage, apart from anything the host
/// stores.
// An interface, not a typedef: platform adapters are swapped as objects.
// ignore: one_member_abstracts
abstract interface class ModuleStorage {
  /// The module's folder, created if needed. Null where there is no file
  /// system (the web).
  Future<String?> moduleDirectory();
}

class AppSupportModuleStorage implements ModuleStorage {
  const AppSupportModuleStorage();

  static const String folder = 'fess_pos';

  @override
  Future<String?> moduleDirectory() async {
    if (kIsWeb) return null;
    final base = await getApplicationSupportDirectory();
    final dir = moduleDirectoryFor(
      base.path,
      android: defaultTargetPlatform == TargetPlatform.android,
    );
    await ensureDirectory(dir);
    return dir;
  }

  /// Android: `<app data>/no_backup/fess_pos`. path_provider's support
  /// directory is the app's `files` folder; its sibling `no_backup` is the
  /// folder `Context.getNoBackupFilesDir()` names, which Android backups
  /// always skip, whatever the host's backup settings. A store restored
  /// onto another phone couldn't be opened anyway (its key never leaves the
  /// device), so keeping it out of backups loses nothing and needs nothing
  /// from the host (D-52).
  ///
  /// Everywhere else: `<app support>/fess_pos`.
  @visibleForTesting
  static String moduleDirectoryFor(
    String supportDir, {
    required bool android,
  }) => android
      ? p.join(p.dirname(supportDir), 'no_backup', folder)
      : p.join(supportDir, folder);
}
