import 'dart:typed_data';

Future<bool> fileExists(String path) async => false;

Future<Uint8List?> readBytes(String path) async => null;

Future<void> writeBytes(String path, Uint8List bytes) =>
    Future.error(UnsupportedError('there is no file system on the web'));

Future<void> deleteFileIfExists(String path) async {}

Future<void> ensureDirectory(String path) =>
    Future.error(UnsupportedError('there is no file system on the web'));
