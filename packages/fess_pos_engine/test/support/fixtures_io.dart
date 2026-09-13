import 'dart:io';

String readText(String path) => File(path).readAsStringSync();

List<String> listJsonFiles(String dir) =>
    Directory(dir)
        .listSync()
        .whereType<File>()
        .map((f) => f.uri.pathSegments.last)
        .where((n) => n.endsWith('.json'))
        .toList()
      ..sort();
