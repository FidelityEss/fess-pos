import 'dart:convert';

import 'package:drift/drift.dart';
import 'package:fess_pos/src/data/local/pos_database.dart';
import 'package:fess_pos/src/data/sync/pull_engine.dart';
import 'package:fess_pos/src/domain/forms/reason_codes.dart';
import 'package:fess_pos/src/domain/jobs/job_record.dart';

/// Jobs from the local store, updated live as pulls land.
class DriftJobRepository implements JobRepository {
  DriftJobRepository(this._db);

  final PosDatabase _db;

  @override
  Stream<List<JobRecord>> watchMine() =>
      (_db.select(_db.jobs)..where((j) => j.assignedToMe.equals(true)))
          .watch()
          .map((rows) => [for (final r in rows) _record(r)]);

  @override
  Stream<JobRecord?> watchJob(String id) =>
      (_db.select(_db.jobs)..where((j) => j.id.equals(id)))
          .watchSingleOrNull()
          .map((r) => r == null ? null : _record(r));

  static JobRecord _record(JobRow r) => JobRecord(
    id: r.id,
    reference: r.reference,
    status: r.status,
    assignedToMe: r.assignedToMe,
    bankId: r.bankId,
    scheduledStart: r.scheduledStartMs == null
        ? null
        : DateTime.fromMillisecondsSinceEpoch(r.scheduledStartMs!),
    data: _object(r.body) ?? {'id': r.id, 'reference': r.reference},
  );
}

/// Definitions in force, from the local store.
class DriftDefinitionRepository implements DefinitionRepository {
  DriftDefinitionRepository(this._db);

  final PosDatabase _db;

  @override
  Stream<Map<String, Object?>?> watchActive(
    String kind,
    String key, {
    String? bankId,
  }) => watchActiveVersion(kind, key, bankId: bankId).map((d) => d?.body);

  @override
  Stream<ActiveDefinition?> watchActiveVersion(
    String kind,
    String key, {
    String? bankId,
  }) {
    final active = _db.activeDefinitions;
    final versions = _db.definitionVersions;
    final query =
        _db.select(active).join([
          innerJoin(versions, versions.versionId.equalsExp(active.versionId)),
        ])..where(
          active.kind.equals(kind) &
              active.key.equals(key) &
              active.context.isIn([bankId ?? '', '']),
        );
    return query.watch().map((rows) {
      TypedResult? pick(String context) {
        for (final r in rows) {
          if (r.readTable(active).context == context) return r;
        }
        return null;
      }

      final row = (bankId == null ? null : pick(bankId)) ?? pick('');
      if (row == null) return null;
      final version = row.readTable(versions);
      final body = _object(version.body);
      return body == null
          ? null
          : ActiveDefinition(
              versionId: version.versionId,
              hash: version.hash,
              body: body,
            );
    });
  }
}

/// `me` and the home-tile totals, from the last pull.
class DriftAgentRepository implements AgentRepository {
  DriftAgentRepository(this._db);

  final PosDatabase _db;

  @override
  Stream<Map<String, Object?>?> watchMe() => _watchDoc(DocKeys.me);

  @override
  Stream<Map<String, Object?>?> watchTotals() => _watchDoc(DocKeys.agentTotals);

  Stream<Map<String, Object?>?> _watchDoc(String key) =>
      (_db.select(_db.cachedDocuments)..where((d) => d.key.equals(key)))
          .watchSingleOrNull()
          .map((r) => r == null ? null : _object(r.body));
}

/// Reference data from the last pull.
class DriftReferenceRepository implements ReferenceRepository {
  DriftReferenceRepository(this._db);

  final PosDatabase _db;

  @override
  Stream<List<ReasonCode>> watchReasonCodes() =>
      (_db.select(_db.cachedDocuments)
            ..where((d) => d.key.equals(DocKeys.reasonCodes)))
          .watchSingleOrNull()
          .map((r) => r == null ? const [] : _reasonCodes(r.body));
}

List<ReasonCode> _reasonCodes(String json) {
  try {
    final v = jsonDecode(json);
    if (v is! List<Object?>) return const [];
    return [for (final item in v) ?ReasonCode.tryParse(item)];
  } on FormatException {
    return const [];
  }
}

Map<String, Object?>? _object(String json) {
  try {
    final v = jsonDecode(json);
    return v is Map<String, Object?> ? v : null;
  } on FormatException {
    return null;
  }
}
