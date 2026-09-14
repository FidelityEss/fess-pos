import 'package:drift/drift.dart';

/// An opened (lazily) local database, plus any store that had to be moved
/// aside to open it (D-52).
class LocalExecutor {
  const LocalExecutor(this.executor, {this.quarantined = const []});

  final QueryExecutor executor;

  /// Names of stores moved into `quarantine/` because they could never be
  /// opened again. Kept on the device and reported, never deleted.
  final List<String> quarantined;
}
