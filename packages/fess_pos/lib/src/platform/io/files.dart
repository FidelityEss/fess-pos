/// File-system helpers: `dart:io` on native, stubs on the web (no file
/// system there; the database lives in the browser's storage).
library;

export 'files_io.dart' if (dart.library.js_interop) 'files_web.dart';
