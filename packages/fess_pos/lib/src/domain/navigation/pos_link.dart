import 'package:meta/meta.dart';

final RegExp _id = RegExp(r'^[0-9A-Za-z-]{1,64}$');

/// A place in the module a deep link opens (docs/03 §3): the host forwards
/// links under `/pos/…` on either of its schemes, e.g.
/// `fidelity://fess.com/pos/job/<id>` or `fess://pos/card`.
@immutable
sealed class PosLink {
  const PosLink();

  /// The link's place, or null when it isn't the module's. A link under
  /// `/pos` whose page this build doesn't know opens the home page.
  static PosLink? parse(Uri uri) {
    final List<String> rest;
    final segments = uri.pathSegments.where((s) => s.isNotEmpty).toList();
    if (uri.host == 'pos') {
      rest = segments;
    } else if (segments.isNotEmpty && segments.first == 'pos') {
      rest = segments.sublist(1);
    } else {
      return null;
    }
    return switch (rest) {
      ['job', final id] when _id.hasMatch(id) => JobLink(id),
      ['card'] => const CardLink(),
      _ => const HomeLink(),
    };
  }

  /// For telemetry: which page, never which record.
  String get page;
}

/// The POS home page.
final class HomeLink extends PosLink {
  const HomeLink();

  @override
  String get page => 'home';

  @override
  bool operator ==(Object other) => other is HomeLink;

  @override
  int get hashCode => (HomeLink).hashCode;
}

/// A job's page.
final class JobLink extends PosLink {
  const JobLink(this.jobId);

  final String jobId;

  @override
  String get page => 'job';

  @override
  bool operator ==(Object other) => other is JobLink && other.jobId == jobId;

  @override
  int get hashCode => jobId.hashCode;
}

/// The agent's authorisation card.
final class CardLink extends PosLink {
  const CardLink();

  @override
  String get page => 'card';

  @override
  bool operator ==(Object other) => other is CardLink;

  @override
  int get hashCode => (CardLink).hashCode;
}
