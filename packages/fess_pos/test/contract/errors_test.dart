import 'package:fess_pos/fess_pos.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('PosException.fromApiError', () {
    test('passes the API code, message and retryable flag through', () {
      final e = PosException.fromApiError(const {
        'error': {
          'code': 'SESSION_REVOKED',
          'message': 'revoked',
          'retryable': false,
          'details': {'x': 1},
        },
        'request_id': 'req-1',
      }, status: 403);
      expect(e.code, 'SESSION_REVOKED');
      expect(e.message, 'revoked');
      expect(e.retryable, isFalse);
      expect(e.kind, PosErrorKind.auth);
      expect(e.requestId, 'req-1');
      expect(e.details, {'x': 1});
    });

    test('a malformed body takes its retryability from the status', () {
      for (final (status, retryable) in [
        (500, true),
        (503, true),
        (408, true),
        (429, true),
        (400, false),
        (404, false),
      ]) {
        final e = PosException.fromApiError(
          '<html>bad gateway</html>',
          status: status,
          requestId: 'r',
        );
        expect(e.code, PosErrorCodes.apiErrorMalformed);
        expect(e.retryable, retryable, reason: 'HTTP $status');
        expect(e.requestId, 'r');
      }
    });

    test('a body missing the retryable flag counts as malformed', () {
      final e = PosException.fromApiError(const {
        'error': {'code': 'X', 'message': 'm'},
        'request_id': 'r',
      }, status: 502);
      expect(e.code, PosErrorCodes.apiErrorMalformed);
      expect(e.retryable, isTrue);
    });
  });

  test('toString carries no secrets from the contract types', () {
    final token = const PosIdentityToken(
      token: 'SECRET',
      issuer: 'pos_dev',
    ).toString();
    expect(token, isNot(contains('SECRET')));
    final profile = PosUserProfile(
      employeeNumber: 'E1',
      firstName: 'Nomsa',
      lastName: 'Dlamini',
      email: 'n@example.com',
    ).toString();
    expect(profile, isNot(contains('Nomsa')));
    expect(profile, isNot(contains('example.com')));
    final bootstrap = PosBootstrap(
      apiBaseUrl: Uri.parse('https://x.example'),
      publishableKey: 'sb_publishable_KEY',
      environment: PosEnvironment.qa,
    ).toString();
    expect(bootstrap, isNot(contains('KEY')));
  });
}
