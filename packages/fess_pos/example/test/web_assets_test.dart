import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';

/// The `sqlite3.wasm` of the sqlite3 2.9.4 release, the version the module
/// pins (T3-24). Replace it only together with the module's sqlite3 version.
const String _sqlite3WasmSha256 =
    '922a76b182b6af69b030c8e2fdd3283ecc8e827248b20e4b1f3f3db170b52117';

void main() {
  test('the web build serves the local store files beside index.html '
      '(T3-24)', () {
    final wasm = File('web/sqlite3.wasm');
    expect(wasm.existsSync(), isTrue);
    expect(
      sha256.convert(wasm.readAsBytesSync()).toString(),
      _sqlite3WasmSha256,
    );

    final worker = File('web/drift_worker.js');
    expect(worker.existsSync(), isTrue);
    expect(worker.lengthSync(), greaterThan(0));
  });
}
