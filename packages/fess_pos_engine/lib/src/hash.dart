/// SHA-256 and the JCS hashes used across POS: `payload_hash`, `answers_hash`
/// and `definition_hash` = hex(sha256(utf8(JCS(value)))) — docs/12 §11.
///
/// The twin of `packages/fess_pos_engine_ts/src/hash.ts`. These are
/// synchronous; the module runs them in an isolate for large inputs
/// (docs/03 §8).
library;

import 'dart:convert' show utf8;

import 'package:crypto/crypto.dart' as crypto;
import 'package:fess_pos_engine/src/jcs.dart';

/// Lower-case hex SHA-256 of raw bytes.
String sha256HexBytes(List<int> bytes) =>
    crypto.sha256.convert(bytes).toString();

/// Lower-case hex SHA-256 of the UTF-8 encoding of [s].
String sha256Hex(String s) => sha256HexBytes(utf8.encode(s));

/// sha256(JCS(value)) — the envelope `payload_hash` (docs/12 §4).
String payloadHash(Object? value) => sha256Hex(canonicalize(value));

/// sha256(JCS(answers)) — the answers document `answers_hash` (docs/04 §5).
String answersHash(Object? answers) => sha256Hex(canonicalize(answers));

/// sha256(JCS(definition)) — `definition_hash` written at publish (docs/04 §7).
String definitionHash(Object? definition) =>
    sha256Hex(canonicalize(definition));

/// Lower-case hex SHA-256, as every POS hash is written.
final RegExp sha256HexPattern = RegExp(r'^[0-9a-f]{64}$');
