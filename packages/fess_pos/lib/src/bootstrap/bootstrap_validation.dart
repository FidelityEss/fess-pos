import 'dart:convert';

import 'package:fess_pos/src/contract/bootstrap.dart';

/// Everything wrong with [bootstrap], or an empty list.
///
/// The API URL must be absolute HTTPS (plain HTTP only for a loopback host
/// in `dev`) with no credentials, query or fragment. The key must be the
/// client-safe publishable key: a secret or service-role key is refused, so
/// a misconfigured flavour can't ship one inside the app.
List<String> bootstrapProblems(PosBootstrap bootstrap) {
  final problems = <String>[];
  final url = bootstrap.apiBaseUrl;
  if (!url.isAbsolute || url.host.isEmpty) {
    problems.add('apiBaseUrl must be an absolute URL');
  } else {
    final httpAllowed =
        bootstrap.environment == PosEnvironment.dev && _isLoopback(url.host);
    if (url.scheme != 'https' && !(url.scheme == 'http' && httpAllowed)) {
      problems.add(
        'apiBaseUrl must use https (http only for a loopback host in dev)',
      );
    }
    if (url.userInfo.isNotEmpty) {
      problems.add('apiBaseUrl must not carry credentials');
    }
    if (url.hasQuery || url.hasFragment) {
      problems.add('apiBaseUrl must not have a query or fragment');
    }
  }
  final key = bootstrap.publishableKey.trim();
  if (key.isEmpty) {
    problems.add('publishableKey is empty');
  } else if (_looksLikeSecretKey(key)) {
    problems.add(
      'publishableKey looks like a secret or service key; '
      'pass the publishable key only',
    );
  }
  return problems;
}

bool _isLoopback(String host) =>
    host == 'localhost' ||
    host == '127.0.0.1' ||
    host == '::1' ||
    host == '10.0.2.2'; // the Android emulator's view of its host

bool _looksLikeSecretKey(String key) {
  if (key.startsWith('sb_secret_')) return true;
  // Legacy Supabase keys are JWTs; the service key says role=service_role.
  final parts = key.split('.');
  if (parts.length != 3) return false;
  try {
    final payload = jsonDecode(
      utf8.decode(base64Url.decode(base64Url.normalize(parts[1]))),
    );
    return payload is Map<String, Object?> && payload['role'] == 'service_role';
  } on FormatException {
    return false;
  }
}
