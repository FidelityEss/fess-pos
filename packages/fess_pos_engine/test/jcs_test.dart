import 'dart:convert';
import 'dart:typed_data';

import 'package:fess_pos_engine/fess_pos_engine.dart';
import 'package:test/test.dart';

import 'support/fixtures.dart';

/// Builds a double from its big-endian IEEE 754 bits (32-bit halves, so it
/// also works when compiled to JavaScript).
double _fromHex(String hex) {
  final bytes = ByteData(8)
    ..setUint32(0, int.parse(hex.substring(0, 8), radix: 16))
    ..setUint32(4, int.parse(hex.substring(8), radix: 16));
  return bytes.getFloat64(0);
}

Matcher _throwsJcs(String code) =>
    throwsA(isA<JcsError>().having((e) => e.code, 'code', code));

void main() {
  group('JCS fixture contract (schema/fixtures/jcs)', () {
    for (final f in fixtures('jcs')) {
      group(f.name, () {
        for (final c in f.cases) {
          test(c['name']! as String, () {
            final hex = c['ieee754_hex'] as String?;
            final Object? value = hex != null
                ? _fromHex(hex)
                : jsonDecode(c['input_json']! as String);
            final error = c['error'] as String?;
            if (error != null) {
              expect(() => canonicalize(value), _throwsJcs(error));
              return;
            }
            expect(canonicalize(value), c['canonical']);
            final sha = c['sha256'] as String?;
            if (sha != null) {
              expect(sha256Hex(c['canonical']! as String), sha);
              expect(payloadHash(value), sha);
            }
          });
        }
      });
    }
  });

  group('canonicalize edge cases', () {
    test('negative zero is 0', () {
      expect(canonicalize(-0.0), '0');
      expect(canonicalize(<Object?>[-0.0, 0]), '[0,0]');
    });

    test('ints and integral doubles serialise the same', () {
      expect(canonicalize(100), '100');
      expect(canonicalize(100.0), '100');
      expect(canonicalize(-7), '-7');
    });

    test('exactly representable large ints are accepted', () {
      // JavaScript's String(2 ** 60): shortest digits, padded with zeros.
      final twoTo60 = int.parse('1152921504606846976');
      expect(canonicalize(twoTo60), '1152921504606847000');
    });

    test(
      'ints a double cannot hold exactly are rejected, never rounded',
      () {
        final inexact = int.parse('9007199254740993'); // 2^53 + 1
        expect(() => canonicalize(inexact), _throwsJcs('JCS_UNSUPPORTED_TYPE'));
      },
      testOn: 'vm', // on the web every int is already a double
    );

    test('rejects values JSON cannot carry', () {
      for (final v in <Object?>[
        DateTime(2026),
        Object(),
        <int>{1},
        <Object?, Object?>{1: 'a'},
        <Object?>[Object()],
      ]) {
        expect(() => canonicalize(v), _throwsJcs('JCS_UNSUPPORTED_TYPE'));
      }
    });

    test('rejects non-finite numbers', () {
      for (final v in [double.nan, double.infinity, double.negativeInfinity]) {
        expect(() => canonicalize(v), _throwsJcs('JCS_NON_FINITE_NUMBER'));
      }
    });

    test('rejects absurd nesting', () {
      Object? v = 1;
      for (var i = 0; i < 1002; i++) {
        v = <Object?>[v];
      }
      expect(() => canonicalize(v), _throwsJcs('JCS_TOO_DEEP'));
    });

    test('null map values are kept as null', () {
      expect(
        canonicalize(<String, Object?>{'b': null, 'a': 1}),
        '{"a":1,"b":null}',
      );
    });
  });

  group('hashing', () {
    test('sha256 of bytes and strings agree', () {
      const empty =
          'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
      expect(sha256Hex(''), empty);
      expect(sha256HexBytes(const <int>[]), empty);
      expect(
        sha256HexBytes(utf8.encode('abc')),
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      );
    });

    test('answers and definition hashes are JCS hashes', () {
      final v = <String, Object?>{
        'b': [1, 2],
        'a': 'x',
      };
      final expected = sha256Hex('{"a":"x","b":[1,2]}');
      expect(answersHash(v), expected);
      expect(definitionHash(v), expected);
      expect(payloadHash(v), expected);
    });
  });
}
