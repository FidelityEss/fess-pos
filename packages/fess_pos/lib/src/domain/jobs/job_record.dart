import 'package:meta/meta.dart';

/// A job on the device, as the server last sent it (docs/05, docs/08 §2).
@immutable
class JobRecord {
  const JobRecord({
    required this.id,
    required this.reference,
    required this.status,
    required this.assignedToMe,
    required this.data,
    this.bankId,
    this.scheduledStart,
  });

  final String id;
  final String reference;

  /// The server's job status, e.g. `assigned`.
  final String status;

  /// Assigned to this agent now; a job reassigned away stays on the device
  /// but not in their lists.
  final bool assignedToMe;
  final String? bankId;
  final DateTime? scheduledStart;

  /// The job as the server sent it: what views bind to as `job.*`.
  final Map<String, Object?> data;

  @override
  String toString() => 'JobRecord($id, $status)';
}

/// The jobs on this device.
abstract interface class JobRepository {
  /// The agent's own jobs (assigned to them now), as each pull lands.
  Stream<List<JobRecord>> watchMine();

  /// One job, or null once it's gone from the device.
  Stream<JobRecord?> watchJob(String id);
}

/// A definition version in force: what a submission names it by.
@immutable
class ActiveDefinition {
  const ActiveDefinition({
    required this.versionId,
    required this.hash,
    required this.body,
  });

  final String versionId;

  /// `definition_hash`, checked against [body] when it was pulled.
  final String hash;
  final Map<String, Object?> body;
}

/// Definitions in force on this device (docs/04 §7).
abstract interface class DefinitionRepository {
  /// The `kind`/`key` definition in force for [bankId] — the bank's own if
  /// it has one, otherwise the default — or null before one arrives.
  Stream<Map<String, Object?>?> watchActive(
    String kind,
    String key, {
    String? bankId,
  });

  /// As [watchActive], with its version id and hash.
  Stream<ActiveDefinition?> watchActiveVersion(
    String kind,
    String key, {
    String? bankId,
  });
}

/// What the server says about the signed-in agent.
abstract interface class AgentRepository {
  /// `me` from the last pull: name, employee number, role, attributes.
  Stream<Map<String, Object?>?> watchMe();

  /// Totals for the home tiles (`stats.*`).
  Stream<Map<String, Object?>?> watchTotals();
}
