import 'dart:async';
import 'dart:typed_data';

import 'package:fess_pos/src/domain/geofence/geofence.dart';
import 'package:fess_pos/src/domain/inspections/inspections.dart';
import 'package:fess_pos/src/domain/jobs/job_actions.dart';
import 'package:fess_pos/src/domain/jobs/job_record.dart';
import 'package:fess_pos/src/domain/preview/preview_request.dart';

/// Inspections in a preview (T3-12, D-90): a flow walks as it would on the
/// phone, with its answers, photos and signatures held in memory only.
/// Nothing is written to the local store or sent, and everything goes when
/// the preview does. There is no location to check in a preview, so the
/// check counts as passed and the flow opens on its first page after it.
class PreviewInspections implements Inspections {
  PreviewInspections(this.request, {DateTime Function()? clock})
    : _clock = clock ?? DateTime.now;

  final PreviewRequest request;
  final DateTime Function() _clock;

  final Map<String, InspectionRecord> _records = {};
  final Map<String, List<EvidenceItem>> _evidence = {};
  final Map<String, Uint8List> _bytes = {};
  final StreamController<void> _changes = StreamController.broadcast();
  int _next = 0;

  /// The flow a job's inspection runs in this preview: a flow draft itself,
  /// else the bundle's inspection flow.
  String get flowKey => request.kind == 'flow'
      ? request.family ?? inspectionFlowKey
      : inspectionFlowKey;

  /// The form [flowKey]'s flow asks, when the preview has it; null when the
  /// flow names none or the preview doesn't carry it.
  String? get formKey {
    final flow = request.definitionOf('flow', flowKey);
    final key = flow?['form_family'];
    if (key is! String) return null;
    return request.definitionOf('form', key) == null ? null : key;
  }

  String _id(String prefix) => '$prefix-${++_next}';

  void _changed() {
    if (!_changes.isClosed) _changes.add(null);
  }

  Stream<T> _live<T>(T Function() read) => Stream.multi((c) {
    c.add(read());
    final sub = _changes.stream.listen((_) => c.add(read()));
    c.onCancel = sub.cancel;
  });

  @override
  Future<BeginResult> begin(JobRecord job) async {
    final open = _latestOf(job.id);
    if (open != null && !open.submitted) {
      return BeginResult(BeginStatus.begun, inspectionId: open.id);
    }
    final form = formKey;
    if (form == null) return const BeginResult(BeginStatus.definitionsMissing);
    final id = _id('preview-inspection');
    _records[id] = InspectionRecord(
      id: id,
      jobId: job.id,
      attempt: 1,
      status: 'in_progress',
      formVersionId: previewVersionId('form', form),
      flowVersionId: previewVersionId('flow', flowKey),
      contextSnapshot: {
        ...request.context,
        'job': job.data,
        'inspection': {
          'attempt': 1,
          'geofence': const {
            'inside': true,
            'method': 'preview',
            'profile': null,
            'relaxed': false,
            'override': false,
          },
          'client_type': 'preview',
          'started_at': _clock().toIso8601String(),
        },
      },
      values: const {},
      otherText: const {},
      currentStep: 0,
      startedAtDevice: _clock().toIso8601String(),
    );
    _changed();
    return BeginResult(BeginStatus.begun, inspectionId: id);
  }

  InspectionRecord? _latestOf(String jobId) =>
      _records.values.where((r) => r.jobId == jobId).lastOrNull;

  @override
  Stream<InspectionRecord?> watchLatest(String jobId) =>
      _live(() => _latestOf(jobId));

  @override
  Stream<InspectionRecord?> watch(String inspectionId) =>
      _live(() => _records[inspectionId]);

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
    final r = _records[inspectionId];
    if (r == null || r.submitted) return;
    _records[inspectionId] = _copy(
      r,
      values: values,
      otherText: otherText,
      currentStep: currentStep,
      unknownDates: unknownDates,
      flaggedDiffers: flaggedDiffers,
      flowPath: flowPath,
    );
    // As the phone's store does: whoever watches sees the draft, so a flow
    // walked again opens with its answers.
    _changed();
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
    final id = _id('preview-photo');
    _bytes[id] = photo.bytes;
    await photo.releaseSource();
    _addEvidence(
      inspectionId,
      EvidenceItem(
        id: id,
        fieldKey: fieldKey,
        type: 'photo',
        state: 'local_only',
        caption: caption,
      ),
    );
    return id;
  }

  @override
  Future<String> recordSignature(
    String inspectionId, {
    required String fieldKey,
    required SignatureCapture signature,
    String? signerName,
    String? signerDesignation,
  }) async {
    final id = _id('preview-signature');
    _bytes[id] = signature.png;
    _addEvidence(
      inspectionId,
      EvidenceItem(
        id: id,
        fieldKey: fieldKey,
        type: 'signature',
        state: 'local_only',
        signerName: signerName,
        signerDesignation: signerDesignation,
      ),
    );
    return id;
  }

  void _addEvidence(String inspectionId, EvidenceItem item) {
    (_evidence[inspectionId] ??= []).add(item);
    _changed();
  }

  @override
  Future<Uint8List?> evidenceBytes(String evidenceId) async =>
      _bytes[evidenceId];

  @override
  Stream<List<EvidenceItem>> watchEvidence(String inspectionId) =>
      _live(() => List.unmodifiable(_evidence[inspectionId] ?? const []));

  /// No location to judge a preview by.
  @override
  Future<GeofencePlan?> geofencePlan(String inspectionId) async => null;

  @override
  Future<void> recordLocationCheck(
    String inspectionId, {
    required bool passed,
    required FixVerdict? verdict,
    required int sampledSeconds,
    String method = 'inside_fix',
    GeoFix? checkin,
    Map<String, Object?>? override,
  }) async {}

  @override
  Future<CheckinPlan?> checkinPlan(JobRecord job) async => null;

  @override
  Future<void> recordCheckin(String jobId, GeoFix fix) async {}

  @override
  Future<void> recordGeofenceChange(
    String inspectionId,
    GeofenceChange change,
  ) async {}

  @override
  Future<void> recordTrace(
    String inspectionId,
    GeoFix fix, {
    bool? inside,
    String event = 'fix',
  }) async {}

  /// Ends as if the server had it; nothing is sealed or sent.
  @override
  Future<JobActionResult> submit(
    String inspectionId, {
    required Map<String, Object?> answers,
  }) async {
    final r = _records[inspectionId];
    if (r == null) return const JobActionResult.notAllowed();
    final at = _clock().toIso8601String();
    _records[inspectionId] = _copy(r, status: 'submitted', submittedAt: at);
    _changed();
    return const JobActionResult.recorded('preview');
  }

  @override
  Future<void> sendNow() async {}

  @override
  Stream<DeliveryState> watchDelivery(String envelopeId) =>
      Stream.value(DeliveryState.delivered);

  /// Lets go of everything the preview held.
  void dispose() {
    _records.clear();
    _evidence.clear();
    _bytes.clear();
    unawaited(_changes.close());
  }

  static InspectionRecord _copy(
    InspectionRecord r, {
    Map<String, Object?>? values,
    Map<String, String>? otherText,
    int? currentStep,
    Set<String>? unknownDates,
    Set<String>? flaggedDiffers,
    List<List<int>>? flowPath,
    String? status,
    String? submittedAt,
  }) => InspectionRecord(
    id: r.id,
    jobId: r.jobId,
    attempt: r.attempt,
    status: status ?? r.status,
    formVersionId: r.formVersionId,
    flowVersionId: r.flowVersionId,
    contextSnapshot: r.contextSnapshot,
    values: values ?? r.values,
    otherText: otherText ?? r.otherText,
    currentStep: currentStep ?? r.currentStep,
    startedAtDevice: r.startedAtDevice,
    unknownDates: unknownDates ?? r.unknownDates,
    flaggedDiffers: flaggedDiffers ?? r.flaggedDiffers,
    flowPath: flowPath ?? r.flowPath,
    submittedAtDevice: submittedAt ?? r.submittedAtDevice,
    submissionEnvelopeId: status == 'submitted'
        ? 'preview'
        : r.submissionEnvelopeId,
  );
}
