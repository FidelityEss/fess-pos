import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;

import 'package:drift/drift.dart';
import 'package:fess_pos/src/core/config/remote_config.dart';
import 'package:fess_pos/src/core/logging/pos_logger.dart';
import 'package:fess_pos/src/core/time/device_time.dart';
import 'package:fess_pos/src/data/local/photo_pipeline.dart';
import 'package:fess_pos/src/data/local/pos_database.dart';
import 'package:fess_pos/src/data/outbox/action_recorder.dart';
import 'package:fess_pos/src/data/outbox/envelope.dart';
import 'package:fess_pos/src/data/outbox/outbox_store.dart';
import 'package:fess_pos/src/data/sync/pull_engine.dart';
import 'package:fess_pos/src/domain/geofence/geofence.dart';
import 'package:fess_pos/src/domain/inspections/inspections.dart';
import 'package:fess_pos/src/domain/jobs/job_actions.dart';
import 'package:fess_pos/src/domain/jobs/job_record.dart';
import 'package:fess_pos/src/platform/camera.dart';
import 'package:fess_pos/src/platform/integrity.dart';
import 'package:fess_pos/src/platform/location.dart';
import 'package:fess_pos_engine/fess_pos_engine.dart'
    show
        SubmissionHashInput,
        answersHash,
        haversineM,
        payloadHash,
        sha256HexBytes,
        submissionHash;
import 'package:uuid/uuid.dart';

const PosLogger _log = PosLogger('inspections');

/// Milliseconds since this code first ran in the process: the envelopes'
/// monotonic times, which the wall clock can't move (docs/12 §11).
final Stopwatch _monotonic = Stopwatch()..start();

/// The flow an inspection follows (docs/04 §3.2); its `form_family` names
/// the form.
const String _flowKey = 'site_inspection_flow';

/// An inspection's breadcrumbs waiting to go, how many batches went, and
/// the time of the last fix sent (T4-08).
typedef _Traces = ({
  List<Map<String, Object?>> pending,
  int batches,
  String? lastAt,
});

/// The geofence profile when remote config names none for the job's
/// location type (docs/07 §7).
const Map<String, Object> _defaultProfile = {
  'radius_m': 75,
  'max_accuracy_m': 30,
  'exit_consecutive_fixes': 3,
  'prompt_checkin_on_arrival': false,
};

/// Inspections on the local store (T4-27): each change and the envelope
/// that records it in one transaction (docs/12 §3).
///
/// - the location is judged at the start and, where that fix didn't pass,
///   by the location step (T4-07, D-78); breadcrumbs are kept (T4-08);
/// - a photo is made canonical before it is hashed (T4-02, D-73);
/// - evidence bytes live in the encrypted store itself, read one item at a
///   time (D-65, D-74).
class DriftInspections implements Inspections {
  DriftInspections({
    required OutboxStore outbox,
    required ActionRecorder recorder,
    required Future<EnvelopeOrigin?> Function() origin,
    required Future<void> Function() send,
    required LocationProvider location,
    required IntegritySignalsProvider integrity,
    required Future<Map<String, Object?>> Function() diagnostics,
    DateTime Function()? clock,
    String Function()? newId,
    this.fixTimeout = const Duration(seconds: 10),
  }) : _outbox = outbox,
       _recorder = recorder,
       _origin = origin,
       _send = send,
       _location = location,
       _integrity = integrity,
       _diagnostics = diagnostics,
       _clock = clock ?? DateTime.now,
       _newId = newId ?? const Uuid().v7;

  final OutboxStore _outbox;
  final ActionRecorder _recorder;
  final Future<EnvelopeOrigin?> Function() _origin;
  final Future<void> Function() _send;
  final LocationProvider _location;
  final IntegritySignalsProvider _integrity;
  final Future<Map<String, Object?>> Function() _diagnostics;
  final DateTime Function() _clock;
  final String Function() _newId;

  /// The longest the phone waits for a location fix.
  final Duration fixTimeout;

  PosDatabase get _db => _outbox.database;

  @override
  Future<BeginResult> begin(JobRecord job) async {
    final open = await _latest(job.id);
    if (open != null && open.status == 'in_progress') {
      return BeginResult(BeginStatus.begun, inspectionId: open.id);
    }
    final origin = await _origin();
    final userId = origin?.userId;
    if (origin == null || userId == null) {
      return const BeginResult(BeginStatus.unavailable);
    }
    final flow = await _active('flow', _flowKey, job.bankId);
    final formKey = _string(_decode(flow?.body)?['form_family']);
    final form = formKey == null
        ? null
        : await _active('form', formKey, job.bankId);
    if (flow == null || form == null) {
      return const BeginResult(BeginStatus.definitionsMissing);
    }
    final jobSchema = await _active('job_schema', 'job_attributes', job.bankId);
    final config = await _config(job.bankId);
    final fix = await _fix(fixTimeout);
    final signals = await _integrity.snapshot();
    final token = _decode(
      (await _doc('${DocKeys.sessionTokenPrefix}${job.id}'))?.body,
    );
    final tokenId = _string(token?['token_id']);
    final tokenValue = _string(token?['token']);
    if (tokenId == null) {
      _log.warning(
        'no session token for job ${job.reference}; the server '
        'will flag the inspection',
      );
    }
    final me = _decode((await _doc(DocKeys.me))?.body);
    final totals = _decode((await _doc(DocKeys.agentTotals))?.body);
    final offset = int.tryParse(await _state(SyncKeys.clockOffsetMs) ?? '');
    final now = _clock();
    final started = isoWithOffset(now);
    final attempt = await _nextAttempt(job);
    final geofence = _geofence(job, config, fix, now);
    final integrity = _integrityJson(signals, fix, offset, now);
    final context = <String, Object?>{
      'today': _date(now),
      'job': job.data,
      'agent': me ?? const <String, Object?>{},
      'inspection': {
        'attempt': attempt,
        'geofence': {
          'inside': geofence['passed'],
          'method': geofence['method'],
          'profile': geofence['profile'],
          'relaxed': geofence['relaxed'],
          'override': false,
        },
        'client_type': origin.clientType,
        'started_at': started,
      },
      'stats': totals ?? const <String, Object?>{},
      'previous': null,
    };
    final id = _newId();
    final outcome = await _recorder.record(
      key: 'begin:job:${job.id}',
      origin: origin,
      allowed: () async {
        final row = await _jobRow(job.id);
        final latest = await _latest(job.id);
        return row != null &&
            row.assignedToMe &&
            inspectionBeginStatuses.contains(row.status) &&
            (latest == null || latest.status != 'in_progress');
      },
      apply: () async {
        await _db
            .into(_db.inspections)
            .insert(
              InspectionsCompanion.insert(
                id: id,
                jobId: job.id,
                userId: userId,
                attempt: attempt,
                status: 'in_progress',
                formVersionId: form.versionId,
                formHash: form.hash,
                flowVersionId: flow.versionId,
                flowHash: flow.hash,
                jobSchemaVersionId: Value(jobSchema?.versionId),
                configVersionId: Value(config.versionId),
                contextSnapshot: jsonEncode(context),
                geofence: jsonEncode(geofence),
                integrity: jsonEncode(integrity),
                sessionTokenId: Value(tokenId),
                sessionToken: Value(tokenValue),
                startedAtDevice: started,
                updatedAt: started,
              ),
            );
        await _setJobStatus(job.id, 'in_progress');
        return PendingEnvelope(
          type: 'inspection_started',
          typeVersion: 1,
          entityRef: 'job:${job.id}',
          payload: {
            'inspection_id': id,
            'job_id': job.id,
            'attempt': attempt,
            'session_token_id': tokenId,
            'session_token': tokenValue,
            'form_version_id': form.versionId,
            'definition_hash': form.hash,
            'flow_version_id': flow.versionId,
            'flow_hash': flow.hash,
            'job_schema_version_id': jobSchema?.versionId,
            'config_version_id': config.versionId,
            'context_snapshot': context,
            'geofence_result': geofence,
            'integrity': integrity,
            'started_at_device': started,
            'monotonic_ms': _monotonic.elapsedMilliseconds,
            'clock_offset_ms': offset,
            'gnss_time': null,
          },
        );
      },
    );
    // A second tap while the first ran shares its outcome, so the id is
    // read back rather than taken from this call.
    final begun = await _latest(job.id);
    switch (outcome.status) {
      case ActionStatus.recorded:
        if (begun == null) return const BeginResult(BeginStatus.notAllowed);
        await (_db.update(_db.inspections)..where(
              (i) => i.id.equals(begun.id) & i.startedEnvelopeId.isNull(),
            ))
            .write(
              InspectionsCompanion(
                startedEnvelopeId: Value(outcome.envelopeId),
              ),
            );
        _log.info('inspection begun for job ${job.reference}');
        return BeginResult(BeginStatus.begun, inspectionId: begun.id);
      case ActionStatus.notAllowed:
        return begun != null && begun.status == 'in_progress'
            ? BeginResult(BeginStatus.begun, inspectionId: begun.id)
            : const BeginResult(BeginStatus.notAllowed);
    }
  }

  @override
  Stream<InspectionRecord?> watchLatest(String jobId) =>
      (_db.select(_db.inspections)
            ..where((i) => i.jobId.equals(jobId))
            ..orderBy([(i) => OrderingTerm.desc(i.attempt)])
            ..limit(1))
          .watchSingleOrNull()
          .map((r) => r == null ? null : _record(r));

  @override
  Stream<InspectionRecord?> watch(String inspectionId) =>
      (_db.select(_db.inspections)..where((i) => i.id.equals(inspectionId)))
          .watchSingleOrNull()
          .map((r) => r == null ? null : _record(r));

  @override
  Future<void> saveDraft(
    String inspectionId, {
    required Map<String, Object?> values,
    required Map<String, String> otherText,
    required int currentStep,
    Set<String> unknownDates = const {},
    Set<String> flaggedDiffers = const {},
    List<List<int>> flowPath = const [],
  }) async {
    await (_db.update(_db.inspections)..where(
          (i) => i.id.equals(inspectionId) & i.status.equals('in_progress'),
        ))
        .write(
          InspectionsCompanion(
            draft: Value(
              jsonEncode({
                'values': values,
                'other': otherText,
                'unknown': unknownDates.toList()..sort(),
                'flagged_differs': flaggedDiffers.toList()..sort(),
                'path': flowPath,
              }),
            ),
            currentStep: Value(currentStep),
            updatedAt: Value(isoWithOffset(_clock())),
          ),
        );
  }

  @override
  Future<String> recordPhoto(
    String inspectionId, {
    required String fieldKey,
    required String category,
    required CapturedPhoto photo,
    String? caption,
    String type = 'photo',
  }) async {
    if (photo is! CameraCaptureResult) {
      throw ArgumentError.value(
        photo,
        'photo',
        'evidence comes only from the camera (docs/07 §6)',
      );
    }
    // The location fix is awaited while the photo is processed.
    final fix = _fix(const Duration(seconds: 5));
    final canonical = await _canonical(inspectionId, photo);
    final id = await _recordEvidence(
      inspectionId,
      fieldKey: fieldKey,
      category: category,
      type: type,
      mime: canonical.mime,
      bytes: canonical.bytes,
      capturedAt: photo.capturedAt,
      width: canonical.width,
      height: canonical.height,
      meta: {
        ...canonical.meta,
        if (_textOf(caption, 500) case final String text) 'caption': text,
      },
      pendingFix: fix,
    );
    // Only now is the camera's temporary copy a spare (docs/12 §3).
    await photo.releaseSource();
    return id;
  }

  /// Text as recorded in evidence meta: trimmed, at most [max] characters
  /// (500 for a caption, the `evidence_meta` limit), none when empty.
  static String? _textOf(String? value, int max) {
    final text = value?.trim() ?? '';
    if (text.isEmpty) return null;
    return String.fromCharCodes(text.runes.take(max));
  }

  EvidenceItem _evidenceItem(
    String id,
    String fieldKey,
    String type,
    String state,
    Map<String, Object?>? meta,
  ) => EvidenceItem(
    id: id,
    fieldKey: fieldKey,
    type: type,
    state: state,
    caption: _string(meta?['caption']),
    signerName: _string(meta?['signer_name']),
    signerDesignation: _string(meta?['signer_designation']),
  );

  /// The canonical photo (docs/07 §4 step 2, T4-02) with the limits in
  /// force for the job's bank. A capture that can't be read as an image is
  /// kept as the camera took it and marked, so nothing captured is lost.
  Future<
    ({
      Uint8List bytes,
      String mime,
      int? width,
      int? height,
      Map<String, Object?> meta,
    })
  >
  _canonical(String inspectionId, CameraCaptureResult photo) async {
    final row = await _row(inspectionId);
    final job = row == null
        ? null
        : await (_db.select(
            _db.jobs,
          )..where((j) => j.id.equals(row.jobId))).getSingleOrNull();
    final config = RemoteConfig((await _config(job?.bankId)).values);
    CanonicalPhoto? out;
    try {
      out = await canonicalPhotoInBackground(
        PhotoRequest(
          photo.bytes,
          maxLongEdge: config.integer('photos.max_long_edge_px'),
          quality: config.integer('photos.jpeg_quality'),
        ),
      );
    } on Object catch (e) {
      _log.info('photo kept as taken: not readable (${e.runtimeType})');
    }
    if (out == null) {
      return (
        bytes: photo.bytes,
        mime: photo.mimeType,
        width: null,
        height: null,
        meta: const {'canonical': false},
      );
    }
    return (
      bytes: out.bytes,
      mime: 'image/jpeg',
      width: out.width,
      height: out.height,
      meta: const <String, Object?>{},
    );
  }

  @override
  Future<String> recordSignature(
    String inspectionId, {
    required String fieldKey,
    required SignatureCapture signature,
    String? signerName,
    String? signerDesignation,
  }) {
    if (signature.isEmpty) {
      throw ArgumentError.value(signature, 'signature', 'nothing was drawn');
    }
    return _recordEvidence(
      inspectionId,
      fieldKey: fieldKey,
      category: 'signature',
      type: 'signature',
      mime: 'image/png',
      bytes: signature.png,
      capturedAt: signature.capturedAt,
      width: signature.width,
      height: signature.height,
      // The vector strokes go with their hash (B5.4), and who signed, as
      // the answers said just before (docs/07 §4, D-76).
      meta: {
        'strokes_sha256': payloadHash(signature.strokes),
        'strokes': signature.strokes,
        if (signature.padWidth case final double width)
          'pad': {'width': width, 'height': signature.padHeight},
        if (_textOf(signerName, 200) case final String name)
          'signer_name': name,
        if (_textOf(signerDesignation, 200) case final String designation)
          'signer_designation': designation,
      },
    );
  }

  @override
  Future<GeofencePlan?> geofencePlan(String inspectionId) async {
    final row = await _row(inspectionId);
    if (row == null) return null;
    final result = _decode(row.geofence) ?? const <String, Object?>{};
    final job = await _jobRow(row.jobId);
    final config = RemoteConfig((await _config(job?.bankId)).values);
    final fence = Fence.fromResult(
      result,
      blockOnMock: config.flag('integrity.block_on_mock'),
    );
    if (fence == null) return null;
    final paused =
        await (_db.select(_db.moduleMeta)..where(
              (m) => m.key.equals(MetaKeys.geofencePaused(inspectionId)),
            ))
            .getSingleOrNull();
    return GeofencePlan(
      fence: fence,
      sampleWindow: Duration(
        seconds: config.integer('geofence.sample_seconds'),
      ),
      fixInterval: Duration(
        seconds: config.integer('geofence.trace_interval_s'),
      ),
      passed: result['passed'] == true,
      paused: paused != null,
      outsideFix: _outsideFixRule(config),
      checkin: await _checkin(row.jobId),
      overrideWithinM: math.min(
        fence.radiusM *
            switch (config.value('geofence.override_radius_multiplier')) {
              final num m => m.toDouble(),
              _ => 2.0,
            },
        config.integer('geofence.override_max_m').toDouble(),
      ),
    );
  }

  @override
  Future<void> recordLocationCheck(
    String inspectionId, {
    required bool passed,
    required FixVerdict? verdict,
    required int sampledSeconds,
    String method = 'inside_fix',
    GeoFix? checkin,
    Map<String, Object?>? override,
  }) async {
    await _db.transaction(() async {
      final row = await _row(inspectionId);
      if (row == null || row.status != 'in_progress') return;
      final now = isoWithOffset(_clock());
      // The profile and its numbers stay as frozen at the start (docs/07 §7
      // item 10); the check adds how it went. The submission carries it.
      final result = {
        ...?_decode(row.geofence),
        'method': method,
        'passed': passed,
        'fix': verdict == null ? null : _fixJson(verdict.fix),
        if (checkin != null) 'checkin_fix': _fixJson(checkin),
        if (override != null) ...{
          'override': true,
          'override_detail': override,
        },
        'distance_m': verdict == null
            ? null
            : (verdict.distanceM * 10).roundToDouble() / 10,
        'sampled_seconds': sampledSeconds,
        'evaluated_at_device': now,
      };
      final context = _decode(row.contextSnapshot) ?? const <String, Object?>{};
      final inspection = _map(context['inspection']) ?? const {};
      final geofence = _map(inspection['geofence']) ?? const {};
      await (_db.update(
        _db.inspections,
      )..where((i) => i.id.equals(inspectionId))).write(
        InspectionsCompanion(
          geofence: Value(jsonEncode(result)),
          contextSnapshot: Value(
            jsonEncode({
              ...context,
              'inspection': {
                ...inspection,
                'geofence': {
                  ...geofence,
                  // Proven from outside, or overridden: the agent wasn't
                  // seen inside.
                  'inside':
                      passed && method == 'inside_fix' && override == null,
                  'method': method,
                  if (override != null) 'override': true,
                },
              },
            }),
          ),
          updatedAt: Value(now),
        ),
      );
    });
    // The way in, among the breadcrumbs (T4-08).
    if (passed && verdict != null && override == null) {
      await recordTrace(
        inspectionId,
        checkin ?? verdict.fix,
        inside: true,
        event: checkin != null ? 'checkin' : 'enter',
      );
    }
  }

  @override
  Future<void> recordGeofenceChange(
    String inspectionId,
    GeofenceChange change,
  ) async {
    final origin = await _origin();
    final row = await _row(inspectionId);
    if (origin == null || row == null) {
      _log.warning('a geofence change was not recorded: no session');
      return;
    }
    final action = change.paused ? 'pause' : 'resume';
    final key = MetaKeys.geofencePaused(inspectionId);
    await _recorder.record(
      key: '$action:inspection:$inspectionId',
      origin: origin,
      allowed: () async => (await _row(inspectionId))?.status == 'in_progress',
      apply: () async {
        final now = isoWithOffset(_clock());
        if (change.paused) {
          await _db
              .into(_db.moduleMeta)
              .insertOnConflictUpdate(
                ModuleMetaCompanion.insert(
                  key: key,
                  value: now,
                  updatedAt: now,
                ),
              );
        } else {
          await (_db.delete(
            _db.moduleMeta,
          )..where((m) => m.key.equals(key))).go();
        }
        await _setJobStatus(
          row.jobId,
          change.paused ? 'paused' : 'in_progress',
        );
        return PendingEnvelope(
          type: 'job_event',
          typeVersion: 1,
          entityRef: 'job:${row.jobId}',
          payload: {
            'job_id': row.jobId,
            'action': action,
            'trigger': change.paused ? 'geofence_exit' : 'geofence_enter',
            'inspection_id': inspectionId,
            'fix': _fixJson(change.verdict.fix),
            'config_version_id': row.configVersionId,
          },
        );
      },
    );
    await recordTrace(
      inspectionId,
      change.verdict.fix,
      inside: change.verdict.inside,
      event: change.paused ? 'pause' : 'resume',
    );
    unawaited(_send());
  }

  /// Breadcrumbs wait on the phone until this many are waiting, the oldest
  /// is [_traceMaxAge] old, or an event comes (D-81).
  static const int _traceBatchSize = 30;
  static const Duration _traceMaxAge = Duration(minutes: 5);

  @override
  Future<void> recordTrace(
    String inspectionId,
    GeoFix fix, {
    bool? inside,
    String event = 'fix',
  }) async {
    final origin = await _origin();
    await _db.transaction(() async {
      final row = await _row(inspectionId);
      if (row == null || row.status != 'in_progress') return;
      final state = await _traceState(inspectionId);
      final pending = [
        ...state.pending,
        <String, Object?>{
          'fix_id': _newId(),
          'ts_device': isoWithOffset(fix.at),
          'ts_monotonic_ms': _monotonic.elapsedMilliseconds,
          'gnss_ts': null,
          'lat': fix.lat,
          'lng': fix.lng,
          'accuracy_m': fix.accuracyM,
          'is_mocked': fix.isMocked ?? false,
          'inside_fence': inside,
          'event': event,
        },
      ];
      final oldest = DateTime.tryParse(
        _string(pending.first['ts_device']) ?? '',
      );
      final due =
          event != 'fix' ||
          pending.length >= _traceBatchSize ||
          (oldest != null && fix.at.difference(oldest) >= _traceMaxAge);
      final next = (
        pending: pending,
        batches: state.batches,
        lastAt: state.lastAt,
      );
      // Signed out, they keep waiting; they go with the next one.
      await _saveTraces(
        inspectionId,
        due && origin != null
            ? await _sendTraces(row, _originFor(origin, row.userId), next)
            : next,
      );
    });
  }

  Future<_Traces> _traceState(String inspectionId) async {
    final row =
        await (_db.select(_db.moduleMeta)
              ..where((m) => m.key.equals(MetaKeys.traces(inspectionId))))
            .getSingleOrNull();
    final json = _decode(row?.value);
    return (
      pending: [
        if (json?['pending'] case final List<Object?> list)
          for (final f in list)
            if (f is Map<String, Object?>) f,
      ],
      batches: switch (json?['batches']) {
        final int n => n,
        _ => 0,
      },
      lastAt: _string(json?['last_at']),
    );
  }

  Future<void> _saveTraces(String inspectionId, _Traces traces) {
    final now = isoWithOffset(_clock());
    return _db
        .into(_db.moduleMeta)
        .insertOnConflictUpdate(
          ModuleMetaCompanion.insert(
            key: MetaKeys.traces(inspectionId),
            value: jsonEncode({
              'pending': traces.pending,
              'batches': traces.batches,
              'last_at': traces.lastAt,
            }),
            updatedAt: now,
          ),
        );
  }

  /// Sends what waits as one `traces_batch` (docs/12 §4). Called inside the
  /// caller's transaction, so the envelope and the emptied wait are stored
  /// together.
  Future<_Traces> _sendTraces(
    InspectionRow row,
    EnvelopeOrigin origin,
    _Traces traces,
  ) async {
    if (traces.pending.isEmpty) return traces;
    await _outbox.add(
      origin,
      type: 'traces_batch',
      typeVersion: 1,
      entityRef: 'inspection:${row.id}',
      payload: {
        'inspection_id': row.id,
        'job_id': row.jobId,
        'batch_seq': traces.batches,
        'fixes': traces.pending,
      },
    );
    return (
      pending: const <Map<String, Object?>>[],
      batches: traces.batches + 1,
      lastAt: _string(traces.pending.last['ts_device']),
    );
  }

  @override
  Future<CheckinPlan?> checkinPlan(JobRecord job) async {
    final config = RemoteConfig((await _config(job.bankId)).values);
    final rule = _outsideFixRule(config);
    final location = _map(job.data['location']);
    final lat = _num(location?['lat']);
    final lng = _num(location?['lng']);
    if (rule == null || lat == null || lng == null) return null;
    final name = _string(job.data['location_type']) ?? 'standalone';
    final profiles = _map(_map(config.values?['geofence'])?['profiles']);
    final p = _map(profiles?[name]) ?? _defaultProfile;
    // The flow may ask for a check-in whatever the profile says.
    final flow = _decode((await _active('flow', _flowKey, job.bankId))?.body);
    final always = [
      if (flow?['steps'] case final List<Object?> steps)
        for (final s in steps)
          if (s is Map<String, Object?> &&
              s['type'] == 'location_check' &&
              s['checkin_prompt'] == 'always')
            s,
    ].isNotEmpty;
    return CheckinPlan(
      fence: Fence(
        profile: name,
        lat: lat.toDouble(),
        lng: lng.toDouble(),
        radiusM: (_num(p['radius_m']) ?? 75).toDouble(),
        maxAccuracyM: (_num(p['max_accuracy_m']) ?? 30).toDouble(),
        exitConsecutiveFixes: 3,
        blockOnMock: config.flag('integrity.block_on_mock'),
      ),
      rule: rule,
      prompt: always || p['prompt_checkin_on_arrival'] == true,
      window: Duration(seconds: config.integer('geofence.sample_seconds')),
      checkin: await _checkin(job.id),
    );
  }

  @override
  Future<void> recordCheckin(String jobId, GeoFix fix) async {
    final now = isoWithOffset(_clock());
    await _db
        .into(_db.moduleMeta)
        .insertOnConflictUpdate(
          ModuleMetaCompanion.insert(
            key: MetaKeys.checkin(jobId),
            value: jsonEncode(_fixJson(fix)),
            updatedAt: now,
          ),
        );
  }

  /// The outside fix as the config in force allows it; null when it
  /// doesn't (`geofence.outside_fix.allowed`).
  static OutsideFixRule? _outsideFixRule(RemoteConfig config) =>
      config.flag('geofence.outside_fix.allowed')
      ? OutsideFixRule(
          maxAccuracyM: config
              .integer('geofence.outside_fix.max_accuracy_m')
              .toDouble(),
          validFor: Duration(
            minutes: config.integer('geofence.outside_fix.valid_minutes'),
          ),
        )
      : null;

  /// The check-in kept for [jobId], if any.
  Future<GeoFix?> _checkin(String jobId) async {
    final row = await (_db.select(
      _db.moduleMeta,
    )..where((m) => m.key.equals(MetaKeys.checkin(jobId)))).getSingleOrNull();
    final fix = _decode(row?.value);
    final lat = _num(fix?['lat']);
    final lng = _num(fix?['lng']);
    final accuracy = _num(fix?['accuracy_m']);
    final at = DateTime.tryParse(_string(fix?['ts']) ?? '');
    if (lat == null || lng == null || accuracy == null || at == null) {
      return null;
    }
    return GeoFix(
      lat: lat.toDouble(),
      lng: lng.toDouble(),
      accuracyM: accuracy.toDouble(),
      at: at,
      isMocked: fix?['is_mocked'] == true,
    );
  }

  @override
  Future<Uint8List?> evidenceBytes(String evidenceId) async =>
      (await (_db.select(
        _db.evidence,
      )..where((e) => e.id.equals(evidenceId))).getSingleOrNull())?.bytes;

  @override
  Stream<List<EvidenceItem>> watchEvidence(String inspectionId) {
    final e = _db.evidence;
    // Without the bytes: this is watched while photos are taken (D-74).
    return (_db.selectOnly(e)
          ..addColumns([e.id, e.fieldKey, e.type, e.state, e.meta])
          ..where(e.inspectionId.equals(inspectionId))
          ..orderBy([OrderingTerm.asc(e.createdAtMs)]))
        .watch()
        .map(
          (rows) => [
            for (final r in rows)
              _evidenceItem(
                r.read(e.id)!,
                r.read(e.fieldKey)!,
                r.read(e.type)!,
                r.read(e.state)!,
                _decode(r.read(e.meta)),
              ),
          ],
        );
  }

  @override
  Future<JobActionResult> submit(
    String inspectionId, {
    required Map<String, Object?> answers,
  }) async {
    final origin = await _origin();
    final first = await _row(inspectionId);
    if (origin == null || origin.userId == null) {
      return const JobActionResult.unavailable();
    }
    if (first == null) return const JobActionResult.notAllowed();
    final diagnostics = await _diagnostics();
    final outcome = await _recorder.record(
      key: 'submit:inspection:$inspectionId',
      origin: _originFor(origin, first.userId),
      allowed: () async => (await _row(inspectionId))?.status == 'in_progress',
      apply: () async {
        final row = (await _row(inspectionId))!;
        final items = await _manifest(row.id, answers);
        final now = _clock();
        final submitted = isoWithOffset(now);
        final hash = answersHash(answers);
        final seal = submissionHash(
          SubmissionHashInput(
            answersHash: hash,
            evidenceHashes: [for (final i in items) i['sha256']! as String],
            sessionTokenId: row.sessionTokenId,
            startedAtDevice: row.startedAtDevice,
            submittedAtDevice: submitted,
            deviceId: origin.deviceId,
          ),
        );
        final jobSchemaId = row.jobSchemaVersionId;
        final jobSchemaHash = jobSchemaId == null
            ? null
            : (await (_db.select(_db.definitionVersions)
                        ..where((d) => d.versionId.equals(jobSchemaId)))
                      .getSingleOrNull())
                  ?.hash;
        final offset = int.tryParse(
          await _state(SyncKeys.clockOffsetMs) ?? '',
        );
        await (_db.update(
          _db.inspections,
        )..where((i) => i.id.equals(row.id))).write(
          InspectionsCompanion(
            status: const Value('submitted'),
            submittedAtDevice: Value(submitted),
            updatedAt: Value(submitted),
          ),
        );
        await _setJobStatus(row.jobId, 'submitted');
        // What waits of the breadcrumbs goes first, and the submission
        // counts the batches (T4-08).
        final traces = await _sendTraces(
          row,
          _originFor(origin, row.userId),
          await _traceState(row.id),
        );
        await _saveTraces(row.id, traces);
        return PendingEnvelope(
          type: 'submission',
          typeVersion: 1,
          entityRef: 'job:${row.jobId}',
          payload: {
            'inspection_id': row.id,
            'job_id': row.jobId,
            'attempt': row.attempt,
            'definition_refs': {
              'form': {'version_id': row.formVersionId, 'hash': row.formHash},
              'flow': {'version_id': row.flowVersionId, 'hash': row.flowHash},
              'job_schema': jobSchemaId == null || jobSchemaHash == null
                  ? null
                  : {'version_id': jobSchemaId, 'hash': jobSchemaHash},
            },
            'config_version_id': row.configVersionId,
            'context_snapshot': jsonDecode(row.contextSnapshot),
            'answers': answers,
            'answers_hash': hash,
            'manifest': {
              'items': items,
              'trace_batch_count': traces.batches,
              'last_trace_at': traces.lastAt,
            },
            'session_token_id': row.sessionTokenId,
            'session_token': row.sessionToken,
            'geofence': jsonDecode(row.geofence),
            'integrity': {
              ...(jsonDecode(row.integrity) as Map<String, Object?>),
              'checked_at': submitted,
            },
            'diagnostics': diagnostics,
            'submission_hash': seal,
            'started_at_device': row.startedAtDevice,
            'submitted_at_device': submitted,
            'submitted_monotonic_ms': _monotonic.elapsedMilliseconds,
            'clock_offset_ms': offset,
          },
        );
      },
    );
    switch (outcome.status) {
      case ActionStatus.recorded:
        await (_db.update(_db.inspections)..where(
              (i) =>
                  i.id.equals(inspectionId) & i.submissionEnvelopeId.isNull(),
            ))
            .write(
              InspectionsCompanion(
                submissionEnvelopeId: Value(outcome.envelopeId),
              ),
            );
        _log.info('inspection submitted');
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
      (_db.select(
        _db.outbox,
      )..where((o) => o.id.equals(envelopeId))).watchSingleOrNull().map(
        (row) => switch (row?.state) {
          null ||
          OutboxState.durable ||
          OutboxState.committed => DeliveryState.delivered,
          OutboxState.needsAttention => DeliveryState.needsAttention,
          _ => DeliveryState.waiting,
        },
      );

  // ── evidence ─────────────────────────────────────────────────────────

  Future<String> _recordEvidence(
    String inspectionId, {
    required String fieldKey,
    required String category,
    required String type,
    required String mime,
    required Uint8List bytes,
    required DateTime capturedAt,
    int? width,
    int? height,
    Map<String, Object?> meta = const {},
    Future<LocationFix?>? pendingFix,
  }) async {
    final row = await _row(inspectionId);
    if (row == null || row.status != 'in_progress') {
      throw StateError('inspection $inspectionId is not open on this phone');
    }
    final origin = await _origin();
    if (origin == null) throw StateError('nobody is signed in');
    final fix = await (pendingFix ?? _fix(const Duration(seconds: 5)));
    final id = _newId();
    final now = _clock();
    final sha = sha256HexBytes(bytes);
    final captured = isoWithOffset(capturedAt);
    final monotonic = _monotonic.elapsedMilliseconds;
    final point = fix == null
        ? null
        : {'lat': fix.latitude, 'lng': fix.longitude};
    await _db.transaction(() async {
      await _db
          .into(_db.evidence)
          .insert(
            EvidenceCompanion.insert(
              id: id,
              inspectionId: row.id,
              jobId: row.jobId,
              userId: row.userId,
              fieldKey: fieldKey,
              category: category,
              type: type,
              mime: mime,
              sha256: sha,
              size: bytes.length,
              width: Value(width),
              height: Value(height),
              capturedAtDevice: captured,
              capturedMonotonicMs: monotonic,
              location: Value(
                point == null
                    ? null
                    : jsonEncode({...point, 'accuracy_m': fix!.accuracyM}),
              ),
              isMocked: Value(fix?.isMocked ?? false),
              meta: Value(jsonEncode(meta)),
              bytes: Value(bytes),
              state: 'local_only',
              createdAtMs: now.millisecondsSinceEpoch,
              updatedAt: isoWithOffset(now),
            ),
          );
      await _outbox.add(
        _originFor(origin, row.userId),
        type: 'evidence_meta',
        typeVersion: 1,
        entityRef: 'evidence:$id',
        payload: {
          'evidence_id': id,
          'inspection_id': row.id,
          'job_id': row.jobId,
          'session_token_id': row.sessionTokenId,
          'field_key': fieldKey,
          'category': category,
          'type': type,
          'sha256': sha,
          'bytes': bytes.length,
          'mime': mime,
          'width': width,
          'height': height,
          'captured_at_device': captured,
          'captured_at_monotonic_ms': monotonic,
          'gnss_time': null,
          'location': point,
          'accuracy_m': fix?.accuracyM,
          'is_mocked': fix?.isMocked ?? false,
          'meta': meta,
        },
      );
    });
    return id;
  }

  /// The manifest (docs/12 §7): every evidence item the answers name, in
  /// answer order, with its place in a photo list.
  Future<List<Map<String, Object?>>> _manifest(
    String inspectionId,
    Map<String, Object?> answers,
  ) async {
    final ev = _db.evidence;
    // Without the bytes (D-74).
    final held = {
      for (final r
          in await (_db.selectOnly(ev)
                ..addColumns([
                  ev.id,
                  ev.fieldKey,
                  ev.category,
                  ev.sha256,
                  ev.size,
                ])
                ..where(ev.inspectionId.equals(inspectionId)))
              .get())
        r.read(ev.id)!: r,
    };
    final items = <Map<String, Object?>>[];
    void add(Object? id, int? index) {
      final r = id is String ? held[id] : null;
      if (r == null) return;
      items.add({
        'evidence_id': r.read(ev.id),
        'field_key': r.read(ev.fieldKey),
        'item_index': index,
        'category': r.read(ev.category),
        'sha256': r.read(ev.sha256),
        'bytes': r.read(ev.size),
      });
    }

    for (final entry in answers.values) {
      final v = entry is Map<String, Object?> ? entry['v'] : null;
      if (v is List<Object?>) {
        for (var i = 0; i < v.length; i++) {
          add(v[i], i);
        }
      } else {
        add(v, null);
      }
    }
    return items;
  }

  // ── helpers ──────────────────────────────────────────────────────────

  static EnvelopeOrigin _originFor(EnvelopeOrigin current, String userId) =>
      EnvelopeOrigin(
        deviceId: current.deviceId,
        clientType: current.clientType,
        userId: userId,
        sessionId: current.userId == userId ? current.sessionId : null,
      );

  /// One fix, if the agent has let the module read the location. Asking
  /// for that belongs to the location step (T4-07), never to storage.
  Future<LocationFix?> _fix(Duration limit) async {
    try {
      if (!(await _location.access()).granted) return null;
      return await _location.currentFix(timeLimit: limit);
    } on Object catch (e) {
      _log.info('no location fix (${e.runtimeType})');
      return null;
    }
  }

  Map<String, Object?> _geofence(
    JobRecord job,
    ({Map<String, Object?>? values, String? versionId}) config,
    LocationFix? fix,
    DateTime now,
  ) {
    final profile = _string(job.data['location_type']) ?? 'standalone';
    final profiles = _map(_map(config.values?['geofence'])?['profiles']);
    final p = _map(profiles?[profile]) ?? _defaultProfile;
    final radius = _num(p['radius_m']) ?? 75;
    final maxAccuracy = _num(p['max_accuracy_m']) ?? 30;
    final location = _map(job.data['location']);
    final lat = _num(location?['lat']);
    final lng = _num(location?['lng']);
    final jobPoint = lat == null || lng == null
        ? null
        : {'lat': lat, 'lng': lng};
    final distance = fix == null || lat == null || lng == null
        ? null
        : haversineM(
            (lat: fix.latitude, lng: fix.longitude),
            (lat: lat.toDouble(), lng: lng.toDouble()),
          );
    // Inside = distance − accuracy ≤ radius, by a fix accurate enough and
    // not a refused mocked one (docs/07 §7), as the engine judges it.
    final blockOnMock = RemoteConfig(
      config.values,
    ).flag('integrity.block_on_mock');
    final passed =
        fix != null &&
        distance != null &&
        distance - fix.accuracyM <= radius &&
        fix.accuracyM <= maxAccuracy &&
        !(blockOnMock && (fix.isMocked ?? false));
    final exitFixes = p['exit_consecutive_fixes'];
    return {
      'profile': profile,
      'profile_params': {
        'radius_m': radius,
        'max_accuracy_m': maxAccuracy,
        'exit_consecutive_fixes': exitFixes is int ? math.max(exitFixes, 1) : 3,
        'prompt_checkin_on_arrival': p['prompt_checkin_on_arrival'] == true,
      },
      'method': 'inside_fix',
      'passed': passed,
      'relaxed': _relaxed(p, profiles, RemoteConfig(config.values)),
      'override': false,
      'override_detail': null,
      'job_location': jobPoint,
      'fix': fix == null ? null : _geoFix(fix),
      'checkin_fix': null,
      'distance_m': distance == null
          ? null
          : (distance * 10).roundToDouble() / 10,
      'sampled_seconds': 0,
      'config_version_id': config.versionId,
      'evaluated_at_device': isoWithOffset(now),
    };
  }

  /// The integrity snapshot (docs/07 §5). Until the RASP and attestation
  /// adapters exist (T4-09) the signals are recorded as unavailable in
  /// `extra`, so the server and reviewers never read "false" as "clean".
  static Map<String, Object?> _integrityJson(
    IntegritySnapshot signals,
    LocationFix? fix,
    int? clockOffsetMs,
    DateTime now,
  ) => {
    'mock_location': fix?.isMocked ?? false,
    'rooted': signals.rooted ?? false,
    'hooked': ?signals.hooked,
    'debugger': ?signals.debugger,
    'emulator': ?signals.emulator,
    'tampered': ?signals.tamperedApp,
    'rasp_provider': signals.available ? signals.source : null,
    'attestation': null,
    'clock_offset_ms': clockOffsetMs,
    'checked_at': isoWithOffset(now),
    'extra': {
      'signals_available': signals.available,
      'signals_source': signals.source,
      'mock_location_known': fix?.isMocked != null,
    },
  };

  Future<int> _nextAttempt(JobRecord job) async {
    final pulled = job.data['attempts'];
    final local = await (_db.select(
      _db.inspections,
    )..where((i) => i.jobId.equals(job.id))).get();
    final highest = [
      if (pulled is int) pulled,
      for (final r in local) r.attempt,
    ].fold(0, math.max);
    return highest + 1;
  }

  Future<InspectionRow?> _row(String id) => (_db.select(
    _db.inspections,
  )..where((i) => i.id.equals(id))).getSingleOrNull();

  Future<InspectionRow?> _latest(String jobId) =>
      (_db.select(_db.inspections)
            ..where((i) => i.jobId.equals(jobId))
            ..orderBy([(i) => OrderingTerm.desc(i.attempt)])
            ..limit(1))
          .getSingleOrNull();

  Future<JobRow?> _jobRow(String id) =>
      (_db.select(_db.jobs)..where((j) => j.id.equals(id))).getSingleOrNull();

  Future<void> _setJobStatus(String jobId, String status) async {
    final row = await _jobRow(jobId);
    if (row == null) return;
    await (_db.update(_db.jobs)..where((j) => j.id.equals(jobId))).write(
      JobsCompanion(
        status: Value(status),
        body: Value(jsonEncode({...?_decode(row.body), 'status': status})),
      ),
    );
  }

  /// The [kind]/[key] definition in force for [bankId]: the bank's own,
  /// else the default.
  Future<DefinitionVersionRow?> _active(
    String kind,
    String key,
    String? bankId,
  ) async {
    final rows =
        await (_db.select(_db.activeDefinitions)..where(
              (a) =>
                  a.kind.equals(kind) &
                  a.key.equals(key) &
                  a.context.isIn([bankId ?? '', '']),
            ))
            .get();
    ActiveDefinitionRow? pick(String context) =>
        rows.where((r) => r.context == context).firstOrNull;
    final active = (bankId == null ? null : pick(bankId)) ?? pick('');
    if (active == null) return null;
    return (_db.select(
      _db.definitionVersions,
    )..where((d) => d.versionId.equals(active.versionId))).getSingleOrNull();
  }

  Future<({Map<String, Object?>? values, String? versionId})> _config(
    String? bankId,
  ) async {
    final doc =
        (bankId == null
            ? null
            : await _doc('${DocKeys.configBankPrefix}$bankId')) ??
        await _doc(DocKeys.configDefault);
    final body = _decode(doc?.body);
    return (
      values: _map(body?['values']),
      versionId: _string(body?['config_version_id']),
    );
  }

  Future<CachedDocumentRow?> _doc(String key) => (_db.select(
    _db.cachedDocuments,
  )..where((d) => d.key.equals(key))).getSingleOrNull();

  Future<String?> _state(String key) async => (await (_db.select(
    _db.syncState,
  )..where((s) => s.key.equals(key))).getSingleOrNull())?.value;

  static InspectionRecord _record(InspectionRow r) {
    final draft = _decode(r.draft);
    final other = _map(draft?['other']) ?? const {};
    Set<String> keys(Object? v) => {
      if (v is List<Object?>)
        for (final k in v)
          if (k is String) k,
    };
    return InspectionRecord(
      id: r.id,
      jobId: r.jobId,
      attempt: r.attempt,
      status: r.status,
      formVersionId: r.formVersionId,
      flowVersionId: r.flowVersionId,
      contextSnapshot: _decode(r.contextSnapshot) ?? const {},
      values: _map(draft?['values']) ?? const {},
      otherText: {
        for (final e in other.entries)
          if (e.value is String) e.key: e.value! as String,
      },
      unknownDates: keys(draft?['unknown']),
      flaggedDiffers: keys(draft?['flagged_differs']),
      flowPath: [
        if (draft?['path'] case final List<Object?> path)
          for (final p in path)
            if (p case [final int step, final int page]) [step, page],
      ],
      currentStep: r.currentStep,
      startedAtDevice: r.startedAtDevice,
      submittedAtDevice: r.submittedAtDevice,
      submissionEnvelopeId: r.submissionEnvelopeId,
      locationPassed: _locationPassed(r.geofence),
    );
  }

  /// A profile looser than the default one (`geofence.default_profile`,
  /// the strictest): a wider fence or a looser accuracy (T4-23, D-79).
  static bool _relaxed(
    Map<String, Object?> profile,
    Map<String, Object?>? profiles,
    RemoteConfig config,
  ) {
    final base =
        _map(profiles?[config.text('geofence.default_profile') ?? '']) ??
        _defaultProfile;
    double n(Map<String, Object?> p, String key, double fallback) =>
        (_num(p[key]) ?? fallback).toDouble();
    return n(profile, 'radius_m', 0) > n(base, 'radius_m', 75) ||
        n(profile, 'max_accuracy_m', 0) > n(base, 'max_accuracy_m', 30);
  }

  /// Whether an inspection's location check has passed. One whose job has
  /// no location to fence has nothing to check.
  static bool _locationPassed(String geofence) {
    final result = _decode(geofence) ?? const <String, Object?>{};
    return result['passed'] == true || Fence.fromResult(result) == null;
  }

  /// A fix as `geofence_result` and `job_event` carry it.
  static Map<String, Object?> _fixJson(GeoFix fix) => {
    'lat': fix.lat,
    'lng': fix.lng,
    'accuracy_m': fix.accuracyM,
    'ts': isoWithOffset(fix.at),
    'gnss_ts': null,
    'is_mocked': fix.isMocked ?? false,
  };

  static Map<String, Object?> _geoFix(LocationFix fix) => _fixJson(
    GeoFix(
      lat: fix.latitude,
      lng: fix.longitude,
      accuracyM: fix.accuracyM,
      at: fix.fixTime,
      isMocked: fix.isMocked,
    ),
  );

  static String _date(DateTime now) {
    final t = now.toLocal();
    String two(int n) => n.toString().padLeft(2, '0');
    return '${t.year}-${two(t.month)}-${two(t.day)}';
  }
}

Map<String, Object?>? _decode(String? json) {
  if (json == null) return null;
  try {
    final v = jsonDecode(json);
    return v is Map<String, Object?> ? v : null;
  } on FormatException {
    return null;
  }
}

Map<String, Object?>? _map(Object? v) => v is Map<String, Object?> ? v : null;

String? _string(Object? v) => v is String ? v : null;

num? _num(Object? v) => v is num ? v : null;
