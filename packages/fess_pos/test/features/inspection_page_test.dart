import 'dart:async';
import 'dart:typed_data';

import 'package:fess_pos/src/core/content/bundled_copy.dart';
import 'package:fess_pos/src/core/di/providers.dart';
import 'package:fess_pos/src/domain/inspections/inspections.dart';
import 'package:fess_pos/src/domain/jobs/job_actions.dart';
import 'package:fess_pos/src/domain/jobs/job_record.dart';
import 'package:fess_pos/src/features/inspections/inspection_page.dart';
import 'package:fess_pos/src/features/jobs/job_pages.dart';
import 'package:fess_pos/src/platform/camera.dart';
import 'package:fess_pos/src/platform/platform_services.dart';
import 'package:fess_pos_engine/fess_pos_engine.dart' show compileForm;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';

import '../support/fake_platform.dart';

const String _declarationId = '0192d4e0-7c1a-7b2e-9f00-0000000000d1';

const Map<String, Object?> _form = {
  'spec_version': '1.0',
  'kind': 'form',
  'family': 'site_inspection',
  'version': 1,
  'declaration_key': 'agent_declaration',
  'sections': [
    {
      'key': 'details',
      'title': 'The business',
      'fields': [
        {
          'key': 'merchant_confirm',
          'type': 'text',
          'label': 'Trading name on the signage',
          'required': true,
        },
      ],
    },
    {
      'key': 'photos',
      'title': 'Photographs',
      'fields': [
        {
          'key': 'external_photos',
          'type': 'photo',
          'label': 'Outside',
          'required': true,
          'props': {'category': 'external', 'min_count': 1, 'max_count': 2},
        },
      ],
    },
    {
      'key': 'agent',
      'title': 'Sign-off',
      'fields': [
        {
          'key': 'interviewee_signature',
          'type': 'signature',
          'label': 'Interviewee signature',
          'required': true,
        },
        {
          'key': 'agent_declaration',
          'type': 'declaration',
          'label': 'Agent declaration',
          'required': true,
          'props': {'declaration_key': 'agent_declaration'},
        },
      ],
    },
  ],
};

const Map<String, Object?> _flow = {
  'kind': 'flow',
  'family': 'site_inspection_flow',
  'form_family': 'site_inspection',
  'steps': [
    {'type': 'location_check'},
    {
      'type': 'form',
      'sections': ['details'],
    },
    {
      'type': 'form',
      'sections': ['photos', 'agent'],
    },
    {'type': 'declaration', 'declaration_key': 'agent_declaration'},
    {'type': 'submit', 'label': 'Submit inspection'},
  ],
};

/// Inspections in memory; evidence ids count up.
class _FakeInspections implements Inspections {
  _FakeInspections(this.record);

  InspectionRecord? record;
  final StreamController<InspectionRecord?> _changes =
      StreamController.broadcast();
  final List<({String field, String type})> captured = [];
  final List<Map<String, Object?>> drafts = [];
  Map<String, Object?>? submitted;
  int begins = 0;

  String _nextId() {
    final n = (captured.length + 1).toString().padLeft(12, '0');
    return '0192d4e0-7c1a-7b2e-9f00-$n';
  }

  @override
  Future<BeginResult> begin(JobRecord job) async {
    begins++;
    return BeginResult(BeginStatus.begun, inspectionId: record!.id);
  }

  @override
  Stream<InspectionRecord?> watchLatest(String jobId) => watch('');

  @override
  Stream<InspectionRecord?> watch(String inspectionId) => Stream.multi((c) {
    c.add(record);
    final sub = _changes.stream.listen(c.add);
    c.onCancel = sub.cancel;
  });

  @override
  Future<void> saveDraft(
    String inspectionId, {
    required Map<String, Object?> values,
    required Map<String, String> otherText,
    required int currentStep,
    Set<String> unknownDates = const {},
    Set<String> flaggedDiffers = const {},
  }) async {
    drafts.add({'values': values, 'step': currentStep});
  }

  @override
  Future<String> recordPhoto(
    String inspectionId, {
    required String fieldKey,
    required String category,
    required CapturedPhoto photo,
  }) async {
    final id = _nextId();
    captured.add((field: fieldKey, type: 'photo'));
    return id;
  }

  @override
  Future<String> recordSignature(
    String inspectionId, {
    required String fieldKey,
    required SignatureCapture signature,
  }) async {
    final id = _nextId();
    captured.add((field: fieldKey, type: 'signature'));
    return id;
  }

  @override
  Future<Uint8List?> evidenceBytes(String evidenceId) async => null;

  @override
  Stream<List<EvidenceItem>> watchEvidence(String inspectionId) =>
      const Stream.empty();

  @override
  Future<JobActionResult> submit(
    String inspectionId, {
    required Map<String, Object?> answers,
  }) async {
    submitted = answers;
    return const JobActionResult.recorded('env-submission');
  }

  @override
  Future<void> sendNow() async {}

  @override
  Stream<DeliveryState> watchDelivery(String envelopeId) =>
      Stream.value(DeliveryState.delivered);
}

/// A camera whose shutter always works.
class _Camera implements CameraService {
  @override
  Future<List<PosCamera>> cameras() async => const [
    PosCamera(id: 'back', lens: PosLens.back, sensorOrientation: 90),
  ];

  @override
  Future<CameraSession> open(
    PosCamera camera, {
    PosCameraResolution resolution = PosCameraResolution.veryHigh,
  }) async => _Session();
}

class _Session implements CameraSession {
  @override
  Widget preview() => const SizedBox.expand();

  @override
  Future<CameraCaptureResult> capture() async =>
      CameraCaptureResult.forTesting(bytes: Uint8List.fromList([1, 2, 3]));

  @override
  Future<void> close() async {}
}

InspectionRecord _record() => const InspectionRecord(
  id: 'insp-1',
  jobId: 'j1',
  attempt: 1,
  status: 'in_progress',
  formVersionId: 'form-v',
  flowVersionId: 'flow-v',
  contextSnapshot: {'today': '2026-09-14'},
  values: {},
  otherText: {},
  currentStep: 0,
  startedAtDevice: '2026-09-14T10:00:00.000+02:00',
);

JobRecord _job(String status) => JobRecord(
  id: 'j1',
  reference: 'POS-1',
  status: status,
  assignedToMe: true,
  data: {
    'id': 'j1',
    'reference': 'POS-1',
    'status': status,
    'merchant_name': 'Joe Spaza',
  },
);

void _noop() {}

List<Override> _overrides(_FakeInspections inspections, JobRecord job) => [
  inspectionsProvider.overrideWith((ref) async => inspections),
  jobProvider.overrideWith((ref, id) => Stream.value(job)),
  agentProvider.overrideWith((ref) => Stream.value({'first_name': 'Sipho'})),
  activeDefinitionProvider.overrideWith((ref, key) => Stream.value(null)),
  activeDefinitionVersionProvider.overrideWith(
    (ref, key) => Stream.value(null),
  ),
  jobActionsProvider.overrideWith((ref) async => null),
  definitionVersionProvider.overrideWith(
    (ref, id) async => id == 'form-v' ? _form : _flow,
  ),
  // In place: a background isolate's answer never arrives in a widget test.
  formCompilerProvider.overrideWithValue((form) async => compileForm(form)),
  declarationProvider.overrideWith(
    (ref, key) => Stream.value(
      const Declaration(
        id: _declarationId,
        key: 'agent_declaration',
        version: 1,
        text: 'I visited these premises myself.',
      ),
    ),
  ),
  platformServicesProvider.overrideWithValue(_platform()),
];

PlatformServices _platform() {
  final base = fakePlatform();
  return PlatformServices(
    secureStore: base.secureStore,
    connectivity: base.connectivity,
    location: base.location,
    camera: _Camera(),
    deviceInfo: base.deviceInfo,
    storage: base.storage,
    integrity: base.integrity,
    backgroundWork: base.backgroundWork,
    externalApps: base.externalApps,
  );
}

String _copy(String key) => BundledCopy.text(key);

Future<void> _settle(WidgetTester tester) async {
  for (var i = 0; i < 5; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('an accepted job offers to begin; begin opens the inspection', (
    tester,
  ) async {
    final inspections = _FakeInspections(null);
    await tester.pumpWidget(
      ProviderScope(
        overrides: _overrides(inspections, _job('accepted')),
        child: const MaterialApp(
          home: JobDetailPage(jobId: 'j1', onBack: _noop),
        ),
      ),
    );
    await _settle(tester);
    expect(find.byKey(const ValueKey('job-action-begin')), findsOneWidget);
    inspections.record = _record();
    await tester.tap(find.byKey(const ValueKey('job-action-begin')));
    await _settle(tester);
    expect(inspections.begins, 1);
    expect(find.text('Trading name on the signage *'), findsOneWidget);
  });

  testWidgets('an assigned job must be accepted first', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: _overrides(_FakeInspections(null), _job('assigned')),
        child: const MaterialApp(
          home: JobDetailPage(jobId: 'j1', onBack: _noop),
        ),
      ),
    );
    await _settle(tester);
    expect(find.byKey(const ValueKey('job-action-begin')), findsNothing);
  });

  testWidgets('the flow, step by step, to a sealed submission', (
    tester,
  ) async {
    final inspections = _FakeInspections(_record());
    await tester.pumpWidget(
      ProviderScope(
        overrides: _overrides(inspections, _job('in_progress')),
        child: MaterialApp(
          home: InspectionPage(
            job: _job('in_progress'),
            inspectionId: 'insp-1',
          ),
        ),
      ),
    );
    await _settle(tester);
    expect(find.text('Step 1 of 4'), findsOneWidget);

    // Nothing answered: the step holds.
    await tester.tap(find.byKey(const ValueKey('inspection-next')));
    await _settle(tester);
    expect(find.text(_copy('inspection.fix_answers')), findsOneWidget);

    await tester.enterText(find.byType(TextField), 'Joe Spaza');
    await tester.tap(find.byKey(const ValueKey('inspection-next')));
    await _settle(tester);
    expect(find.text('Step 2 of 4'), findsOneWidget);
    expect(
      find.text('Agent declaration *'),
      findsNothing,
      reason: 'the declaration has its own step',
    );

    // A photo through the camera.
    await tester.tap(find.byKey(const ValueKey('photo-take-external_photos')));
    await _settle(tester);
    await tester.tap(find.byKey(const ValueKey('capture-shutter')));
    await _settle(tester);
    expect(inspections.captured.single.type, 'photo');

    // A signature on the pad; rendering its PNG needs real async.
    await tester.tap(
      find.byKey(const ValueKey('signature-sign-interviewee_signature')),
    );
    await _settle(tester);
    await tester.drag(
      find.byKey(const ValueKey('signature-pad')),
      const Offset(120, 40),
    );
    await tester.pump();
    await tester.runAsync(() async {
      await tester.tap(find.byKey(const ValueKey('signature-done')));
      await Future<void>.delayed(const Duration(milliseconds: 300));
    });
    await _settle(tester);
    expect(inspections.captured.last.type, 'signature');

    await tester.tap(find.byKey(const ValueKey('inspection-next')));
    await _settle(tester);
    expect(find.text('Step 3 of 4'), findsOneWidget);
    expect(find.text('I visited these premises myself.'), findsOneWidget);
    await tester.tap(
      find.byKey(const ValueKey('declaration-accept-agent_declaration')),
    );
    await tester.tap(find.byKey(const ValueKey('inspection-next')));
    await _settle(tester);

    expect(find.text('Step 4 of 4'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('inspection-submit')));
    await _settle(tester);
    await tester.tap(find.byKey(const ValueKey('inspection-submit-confirm')));
    await _settle(tester);

    final answers = inspections.submitted!;
    expect(answers.keys, {
      'merchant_confirm',
      'external_photos',
      'interviewee_signature',
      'agent_declaration',
    });
    expect(
      ((answers['agent_declaration']! as Map)['v']!
          as Map)['declaration_version_id'],
      _declarationId,
    );
    expect(find.text(_copy('outcome.success.title')), findsOneWidget);
    expect(inspections.drafts, isNotEmpty, reason: 'answers kept as given');
  });

  testWidgets('a reopened inspection resumes at its step with its answers', (
    tester,
  ) async {
    final record = _record();
    final inspections = _FakeInspections(
      InspectionRecord(
        id: record.id,
        jobId: record.jobId,
        attempt: 1,
        status: 'in_progress',
        formVersionId: 'form-v',
        flowVersionId: 'flow-v',
        contextSnapshot: record.contextSnapshot,
        values: const {'merchant_confirm': 'Joe Spaza'},
        otherText: const {},
        currentStep: 1,
        startedAtDevice: record.startedAtDevice,
      ),
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: _overrides(inspections, _job('in_progress')),
        child: MaterialApp(
          home: InspectionPage(
            job: _job('in_progress'),
            inspectionId: 'insp-1',
          ),
        ),
      ),
    );
    await _settle(tester);
    expect(find.text('Step 2 of 4'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('inspection-back')));
    await _settle(tester);
    expect(
      find.widgetWithText(TextField, 'Joe Spaza'),
      findsOneWidget,
      reason: 'the answer given before the app closed',
    );
  });
}
