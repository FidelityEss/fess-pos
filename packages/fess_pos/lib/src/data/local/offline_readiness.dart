import 'dart:convert';

import 'package:drift/drift.dart';
import 'package:fess_pos/src/data/local/pos_database.dart';
import 'package:fess_pos/src/data/sync/pull_engine.dart';
import 'package:fess_pos/src/domain/inspections/inspections.dart'
    show inspectionFlowKey;

/// The statuses of a job the agent may still work on.
const List<String> _open = [
  'assigned',
  'accepted',
  'in_progress',
  'paused',
  'returned',
];

const String _tilesPrefix = 'tiles.job.';

/// Which of the agent's jobs are ready to work with no signal (docs/08 §8,
/// T5-09, D-92): a session token still valid, the inspection flow and its
/// form in force for the job's bank, and the map tiles around the job when
/// a map provider is set up and the job has a location.
class OfflineReadiness {
  OfflineReadiness(this._db, {DateTime Function()? clock})
    : _clock = clock ?? DateTime.now;

  final PosDatabase _db;
  final DateTime Function() _clock;

  /// The ready jobs' ids, live.
  Stream<Set<String>> watch() async* {
    yield await ready();
    yield* _db
        .tableUpdates(
          TableUpdateQuery.onAllTables([
            _db.jobs,
            _db.cachedDocuments,
            _db.activeDefinitions,
            _db.definitionVersions,
            _db.syncState,
          ]),
        )
        .asyncMap((_) => ready());
  }

  Future<Set<String>> ready() async {
    final jobs = await (_db.select(
      _db.jobs,
    )..where((j) => j.assignedToMe.equals(true) & j.status.isIn(_open))).get();
    if (jobs.isEmpty) return const {};

    final now = _clock();
    final tokens = <String>{};
    final tokenDocs = await (_db.select(
      _db.cachedDocuments,
    )..where((d) => d.key.like('${DocKeys.sessionTokenPrefix}%'))).get();
    for (final doc in tokenDocs) {
      final validTo = DateTime.tryParse('${_object(doc.body)['valid_to']}');
      if (validTo == null || validTo.isAfter(now)) {
        tokens.add(doc.key.substring(DocKeys.sessionTokenPrefix.length));
      }
    }

    final active = {
      for (final a in await _db.select(_db.activeDefinitions).get())
        '${a.context}|${a.kind}|${a.key}': a.versionId,
    };
    String? inForce(String? bankId, String kind, String key) =>
        (bankId == null ? null : active['$bankId|$kind|$key']) ??
        active['|$kind|$key'];
    Future<bool> definitions(String? bankId) async {
      final flowVersion = inForce(bankId, 'flow', inspectionFlowKey);
      if (flowVersion == null) return false;
      final flow = await (_db.select(
        _db.definitionVersions,
      )..where((d) => d.versionId.equals(flowVersion))).getSingleOrNull();
      final formKey = flow == null ? null : _object(flow.body)['form_family'];
      return formKey is String && inForce(bankId, 'form', formKey) != null;
    }

    final tileUrl = (await readRemoteConfig(_db)).text('maps.tile_url');
    final maps = tileUrl != null && tileUrl.isNotEmpty;
    final tiles = {
      for (final s in await (_db.select(
        _db.syncState,
      )..where((s) => s.key.like('$_tilesPrefix%'))).get())
        s.key.substring(_tilesPrefix.length),
    };

    final ready = <String>{};
    for (final job in jobs) {
      if (!tokens.contains(job.id)) continue;
      if (!await definitions(job.bankId)) continue;
      final location = _object(job.body)['location'];
      if (maps && location is Map && !tiles.contains(job.id)) continue;
      ready.add(job.id);
    }
    return ready;
  }
}

Map<String, Object?> _object(String json) {
  try {
    final v = jsonDecode(json);
    return v is Map<String, Object?> ? v : const {};
  } on FormatException {
    return const {};
  }
}
