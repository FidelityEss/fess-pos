import 'package:fess_pos_engine/fess_pos_engine.dart';
import 'package:test/test.dart';

import 'support/fixtures.dart';

void main() {
  group(
    'submission hash fixture contract (schema/fixtures/submission_hash)',
    () {
      for (final f in fixtures('submission_hash')) {
        group(f.name, () {
          for (final c in f.cases) {
            test(c['name']! as String, () {
              final input = SubmissionHashInput.fromJson(
                c['input']! as Map<String, Object?>,
              );
              final error = c['error'] as String?;
              if (error != null) {
                expect(
                  () => submissionHash(input),
                  throwsA(
                    isA<EngineError>().having((e) => e.code, 'code', error),
                  ),
                );
                return;
              }
              final preimage = c['preimage'] as String?;
              if (preimage != null) {
                expect(submissionHashPreimage(input), preimage);
              }
              expect(submissionHash(input), c['sha256']);
            });
          }
        });
      }
    },
  );

  test('the tag is part of the contract', () {
    expect(submissionHashTag, 'fess-pos/submission-hash/v1');
  });
}
