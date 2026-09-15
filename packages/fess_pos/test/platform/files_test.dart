@TestOn('vm')
library;

import 'dart:io';

import 'package:fess_pos/src/platform/io/files.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test("a folder's size counts every file under it (T5-08)", () async {
    final dir = Directory.systemTemp.createTempSync('pos_size_');
    addTearDown(() => dir.deleteSync(recursive: true));
    File('${dir.path}/a').writeAsBytesSync(List.filled(10, 1));
    Directory('${dir.path}/sub').createSync();
    File('${dir.path}/sub/b').writeAsBytesSync(List.filled(5, 1));
    expect(await directorySize(dir.path), 15);
    expect(await directorySize('${dir.path}/missing'), 0);
  });
}
