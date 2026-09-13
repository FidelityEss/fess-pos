import 'dart:io';

Future<bool> fileExists(String path) async => File(path).existsSync();

Future<void> deleteFileIfExists(String path) async {
  final file = File(path);
  if (file.existsSync()) await file.delete();
}

Future<void> ensureDirectory(String path) async {
  await Directory(path).create(recursive: true);
}
