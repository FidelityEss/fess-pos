import 'package:fess_pos/src/platform/io/files.dart';
import 'package:flutter/foundation.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

/// Where the module keeps its files (the database, encrypted evidence): its
/// own folder in the app's private support directory, apart from anything
/// the host stores.
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
    final dir = p.join(base.path, folder);
    await ensureDirectory(dir);
    return dir;
  }
}
