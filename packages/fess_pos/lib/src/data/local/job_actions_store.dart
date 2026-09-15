import 'dart:convert';

import 'package:drift/drift.dart';
import 'package:fess_pos/src/core/logging/pos_logger.dart';
import 'package:fess_pos/src/data/local/pos_database.dart';
import 'package:fess_pos/src/data/outbox/action_recorder.dart';
import 'package:fess_pos/src/data/outbox/envelope.dart';
import 'package:fess_pos/src/data/outbox/outbox_store.dart';
import 'package:fess_pos/src/data/sync/pull_engine.dart';
import 'package:fess_pos/src/domain/jobs/job_actions.dart';
import 'package:fess_pos/src/domain/jobs/job_record.dart';
import 'package:fess_pos_engine/fess_pos_engine.dart' show answersHash;

const PosLogger _log = PosLogger('jobs');

final RegExp _uuid = RegExp(
  '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
  caseSensitive: false,
);

/// Job actions on the local store (docs/08 §3): the job's new status and
/// its `job_event` envelope in one transaction, behind the
/// [ActionRecorder]'s guards, so a double tap records one action.
class DriftJobActions implements JobActions {
  DriftJobActions({
    required PosDatabase db,
    required ActionRecorder recorder,
    required Future<EnvelopeOrigin?> Function() origin,
    required Future<void> Function() send,
  }) : _db = db,
       _recorder = recorder,
       _origin = origin,
       _send = send;

  final PosDatabase _db;
  final ActionRecorder _recorder;
  final Future<EnvelopeOrigin?> Function() _origin;
  final Future<void> Function() _send;

  @override
  Future<JobActionResult> record(
    JobRecord job,
    JobAction action, {
    ReasonSubmission? reason,
  }) async {
    if (action.reasonCategory != null && reason == null) {
      throw ArgumentError.value(action, 'action', 'needs a reason');
    }
    final origin = await _origin();
    if (origin == null || origin.userId == null) {
      return const JobActionResult.unavailable();
    }
    final outcome = await _recorder.record(
      key: '${action.wire}:job:${job.id}',
      origin: origin,
      allowed: () async {
        final row = await _row(job.id);
        return row != null &&
            jobActionAllowed(
              action,
              JobRecord(
                id: row.id,
                reference: row.reference,
                status: row.status,
                assignedToMe: row.assignedToMe,
                data: const {},
              ),
            );
      },
      apply: () async {
        final row = (await _row(job.id))!;
        final status = statusAfter(action);
        // A rejected job goes back to the schedulers; the others stay the
        // agent's.
        final mine = action != JobAction.reject;
        await (_db.update(_db.jobs)..where((j) => j.id.equals(job.id))).write(
          JobsCompanion(
            status: Value(status),
            assignedToMe: Value(mine),
            body: Value(
              jsonEncode({
                ..._object(row.body),
                'status': status,
                'assigned_to_me': mine,
              }),
            ),
          ),
        );
        return PendingEnvelope(
          type: 'job_event',
          typeVersion: 1,
          entityRef: 'job:${job.id}',
          payload: {
            'job_id': job.id,
            'action': action.wire,
            'trigger': 'agent',
            if (reason != null) ...{
              'reason_code': reason.reasonCode,
              'note': ?reason.note,
              'form_version_id': reason.formVersionId,
              'definition_hash': reason.definitionHash,
              'form_answers': reason.answers,
              'answers_hash': answersHash(reason.answers),
            },
            'evidence_ids': const <String>[],
            'config_version_id': ?await pulledConfigVersion(_db, row.bankId),
          },
        );
      },
    );
    switch (outcome.status) {
      case ActionStatus.recorded:
        _log.info('${action.wire} recorded for job ${job.reference}');
        return JobActionResult.recorded(outcome.envelopeId!);
      case ActionStatus.notAllowed:
        return const JobActionResult.notAllowed();
    }
  }

  @override
  Future<void> sendNow() async {
    try {
      await _send();
    } on Object catch (e, st) {
      _log.warning('could not send now', error: e, stackTrace: st);
    }
  }

  @override
  Stream<DeliveryState> watchDelivery(String envelopeId) =>
      watchEnvelopeDelivery(_db, envelopeId);

  Future<JobRow?> _row(String id) =>
      (_db.select(_db.jobs)..where((j) => j.id.equals(id))).getSingleOrNull();
}

/// Where envelope [envelopeId] is, for an outcome page, live.
Stream<DeliveryState> watchEnvelopeDelivery(
  PosDatabase db,
  String envelopeId,
) => (db.select(db.outbox)..where((o) => o.id.equals(envelopeId)))
    .watchSingleOrNull()
    .map(
      (row) => switch (row?.state) {
        // Gone only after it was committed and kept long enough.
        null ||
        OutboxState.durable ||
        OutboxState.committed => DeliveryState.delivered,
        OutboxState.needsAttention => DeliveryState.needsAttention,
        _ => DeliveryState.waiting,
      },
    );

/// The config version in force for [bankId] (its own, else the default),
/// as pulled.
Future<String?> pulledConfigVersion(PosDatabase db, String? bankId) async {
  for (final key in [
    if (bankId != null) '${DocKeys.configBankPrefix}$bankId',
    DocKeys.configDefault,
  ]) {
    final doc = await (db.select(
      db.cachedDocuments,
    )..where((d) => d.key.equals(key))).getSingleOrNull();
    final hash = doc?.hash;
    if (hash != null && _uuid.hasMatch(hash) && hash.length == 36) {
      return hash;
    }
  }
  return null;
}

Map<String, Object?> _object(String json) {
  try {
    final v = jsonDecode(json);
    return v is Map<String, Object?> ? v : const {};
  } on FormatException {
    return const {};
  }
}
