import 'dart:io';
import 'dart:typed_data';

Future<bool> fileExists(String path) async => File(path).existsSync();

/// The file's bytes; null when it's missing or can't be read.
Future<Uint8List?> readBytes(String path) async {
  final file = File(path);
  if (!file.existsSync()) return null;
  try {
    return await file.readAsBytes();
  } on FileSystemException {
    return null;
  }
}

/// Writes [bytes] to [path] through a temporary file, so a crash never
/// leaves half a file behind.
Future<void> writeBytes(String path, Uint8List bytes) async {
  final file = File(path);
  await file.parent.create(recursive: true);
  final temp = File('$path.part');
  await temp.writeAsBytes(bytes);
  await temp.rename(path);
}

Future<void> deleteFileIfExists(String path) async {
  final file = File(path);
  if (file.existsSync()) await file.delete();
}

Future<void> ensureDirectory(String path) async {
  await Directory(path).create(recursive: true);
}
