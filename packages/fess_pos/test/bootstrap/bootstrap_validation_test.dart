import 'dart:convert';

import 'package:fess_pos/fess_pos.dart';
import 'package:fess_pos/src/bootstrap/bootstrap_validation.dart';
import 'package:fess_pos/src/bootstrap/semver.dart';
import 'package:flutter_test/flutter_test.dart';

PosBootstrap _b(
  String url, {
  String key = 'sb_publishable_abc',
  PosEnvironment env = PosEnvironment.qa,
}) => PosBootstrap(
  apiBaseUrl: Uri.parse(url),
  publishableKey: key,
  environment: env,
);

String _jwt(Map<String, Object?> payload) {
  String part(Object o) =>
      base64Url.encode(utf8.encode(jsonEncode(o))).replaceAll('=', '');
  return '${part({'alg': 'HS256'})}.${part(payload)}.signature';
}

void main() {
  group('bootstrapProblems', () {
    test('accepts an https URL and a publishable key', () {
      expect(
        bootstrapProblems(_b('https://ref.supabase.co/functions/v1/api')),
        isEmpty,
      );
      expect(
        bootstrapProblems(
          _b('https://x.example', key: _jwt({'role': 'anon'})),
        ),
        isEmpty,
      );
    });

    test('refuses plain http, except a loopback host in dev', () {
      expect(bootstrapProblems(_b('http://x.example')), hasLength(1));
      expect(
        bootstrapProblems(_b('http://10.0.2.2:54321', env: PosEnvironment.dev)),
        isEmpty,
      );
      expect(
        bootstrapProblems(
          _b('http://localhost:54321', env: PosEnvironment.prod),
        ),
        hasLength(1),
      );
    });

    test('refuses relative URLs, credentials, queries and fragments', () {
      expect(bootstrapProblems(_b('/v1')), isNotEmpty);
      expect(bootstrapProblems(_b('https://u:p@x.example')), isNotEmpty);
      expect(bootstrapProblems(_b('https://x.example?a=1')), isNotEmpty);
      expect(bootstrapProblems(_b('https://x.example#f')), isNotEmpty);
    });

    test('refuses secret and service-role keys', () {
      expect(bootstrapProblems(_b('https://x.example', key: ' ')), isNotEmpty);
      expect(
        bootstrapProblems(_b('https://x.example', key: 'sb_secret_abc')),
        isNotEmpty,
      );
      expect(
        bootstrapProblems(
          _b('https://x.example', key: _jwt({'role': 'service_role'})),
        ),
        isNotEmpty,
      );
    });
  });

  group('compareSemver', () {
    test('orders by major, minor, patch', () {
      expect(compareSemver('1.2.3', '1.2.3'), 0);
      expect(compareSemver('1.2.3', '1.10.0'), lessThan(0));
      expect(compareSemver('2.0.0', '1.99.99'), greaterThan(0));
    });

    test(
      'a pre-release sorts below its release; build metadata is ignored',
      () {
        expect(compareSemver('1.0.0-rc.1', '1.0.0'), lessThan(0));
        expect(compareSemver('1.0.0-rc.2', '1.0.0-rc.10'), lessThan(0));
        expect(compareSemver('1.0.0-alpha', '1.0.0-1'), greaterThan(0));
        expect(compareSemver('1.0.0+build.5', '1.0.0'), 0);
      },
    );

    test('rejects non-semver', () {
      expect(isSemver('1.2'), isFalse);
      expect(() => compareSemver('1.2', '1.2.0'), throwsFormatException);
    });
  });
}
