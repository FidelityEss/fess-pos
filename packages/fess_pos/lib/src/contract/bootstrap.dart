import 'package:meta/meta.dart';

/// The POS environment a bootstrap points at.
enum PosEnvironment {
  /// A developer machine, pointed at QA (docs/15).
  dev,

  /// fess-pos-qa.
  qa,

  /// fess-pos (production).
  prod,
}

/// Where the module finds the POS API. The host's build flavour injects it;
/// the module has no compiled-in endpoints or keys (docs/03 §9).
@immutable
class PosBootstrap {
  const PosBootstrap({
    required this.apiBaseUrl,
    required this.publishableKey,
    required this.environment,
  });

  /// The POS API base URL for this environment, e.g.
  /// `https://<ref>.supabase.co/functions/v1/api`.
  final Uri apiBaseUrl;

  /// The client-safe publishable key only. `initialize` refuses anything
  /// that looks like a secret or service key.
  final String publishableKey;

  final PosEnvironment environment;

  @override
  String toString() =>
      'PosBootstrap(${environment.name}, $apiBaseUrl, publishableKey: …)';
}
