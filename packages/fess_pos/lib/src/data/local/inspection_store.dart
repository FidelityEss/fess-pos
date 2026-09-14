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
/// - the location check is one fix at the start that never blocks
///   (the geofence engine is T4-07);
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
      type: 'photo',
      mime: canonical.mime,
      bytes: canonical.bytes,
      capturedAt: photo.capturedAt,
      width: canonical.width,
      height: canonical.height,
      meta: canonical.meta,
      pendingFix: fix,
    );
    // Only now is the camera's temporary copy a spare (docs/12 §3).
    await photo.releaseSource();
    return id;
  }

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
      meta: {'strokes_sha256': payloadHash(signature.strokes)},
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
          ..addColumns([e.id, e.fieldKey, e.type, e.state])
          ..where(e.inspectionId.equals(inspectionId))
          ..orderBy([OrderingTerm.asc(e.createdAtMs)]))
        .watch()
        .map(
          (rows) => [
            for (final r in rows)
              EvidenceItem(
                id: r.read(e.id)!,
                fieldKey: r.read(e.fieldKey)!,
                type: r.read(e.type)!,
                state: r.read(e.state)!,
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
              'trace_batch_count': 0,
              'last_trace_at': null,
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
    final passed =
        fix != null &&
        distance != null &&
        distance <= radius &&
        fix.accuracyM <= maxAccuracy;
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
      'relaxed': p['relaxed'] == true,
      'override': false,
      'override_detail': null,
      'job_location': jobPoint,
      'fix': fix == null
          ? null
          : {
              'lat': fix.latitude,
              'lng': fix.longitude,
              'accuracy_m': fix.accuracyM,
              'ts': isoWithOffset(fix.fixTime),
              'gnss_ts': null,
              'is_mocked': fix.isMocked ?? false,
            },
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
    );
  }

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
