/// The submission hash (docs/07 §4), the twin of
/// `packages/fess_pos_engine_ts/src/submission.ts`:
///
///     JCS(["fess-pos/submission-hash/v1", answers_hash,
///          [sorted evidence sha256 hex…], session_token_id,
///          started_at_device, submitted_at_device, device_id])
///
/// and submission_hash = lower-case hex SHA-256 of its UTF-8 bytes. Vectors:
/// `schema/fixtures/submission_hash`.
library;

import 'package:fess_pos_engine/src/errors.dart';
import 'package:fess_pos_engine/src/hash.dart';
import 'package:fess_pos_engine/src/jcs.dart';

const String submissionHashTag = 'fess-pos/submission-hash/v1';

class SubmissionHashInput {
  const SubmissionHashInput({
    required this.answersHash,
    required this.evidenceHashes,
    required this.sessionTokenId,
    required this.startedAtDevice,
    required this.submittedAtDevice,
    required this.deviceId,
  });

  /// Reads the snake_case shape used by the fixtures and the API.
  factory SubmissionHashInput.fromJson(Map<String, Object?> json) =>
      SubmissionHashInput(
        answersHash: json['answers_hash']! as String,
        evidenceHashes: (json['evidence_hashes']! as List<Object?>)
            .cast<String>(),
        sessionTokenId: json['session_token_id'] as String?,
        startedAtDevice: json['started_at_device']! as String,
        submittedAtDevice: json['submitted_at_device']! as String,
        deviceId: json['device_id']! as String,
      );

  final String answersHash;
  final List<String> evidenceHashes;
  final String? sessionTokenId;
  final String startedAtDevice;
  final String submittedAtDevice;
  final String deviceId;
}

String submissionHashPreimage(SubmissionHashInput input) {
  if (!sha256HexPattern.hasMatch(input.answersHash)) {
    throw const EngineError(
      'SUBMISSION_HASH_INVALID_INPUT',
      'answers_hash must be lower-case sha256 hex',
    );
  }
  for (final h in input.evidenceHashes) {
    if (!sha256HexPattern.hasMatch(h)) {
      throw const EngineError(
        'SUBMISSION_HASH_INVALID_INPUT',
        'evidence hashes must be lower-case sha256 hex',
      );
    }
  }
  final sorted = [...input.evidenceHashes]..sort();
  return canonicalize(<Object?>[
    submissionHashTag,
    input.answersHash,
    sorted,
    input.sessionTokenId,
    input.startedAtDevice,
    input.submittedAtDevice,
    input.deviceId,
  ]);
}

String submissionHash(SubmissionHashInput input) =>
    sha256Hex(submissionHashPreimage(input));
