import 'dart:async';
import 'dart:typed_data';

import 'package:fess_pos/src/core/content/bundled_copy.dart';
import 'package:fess_pos/src/core/di/providers.dart';
import 'package:fess_pos/src/domain/geofence/geofence.dart';
import 'package:fess_pos/src/domain/inspections/inspections.dart';
import 'package:fess_pos/src/domain/jobs/job_actions.dart';
import 'package:fess_pos/src/domain/jobs/job_record.dart';
import 'package:fess_pos/src/features/inspections/inspection_page.dart';
import 'package:fess_pos/src/features/jobs/job_pages.dart';
import 'package:fess_pos/src/platform/camera.dart';
import 'package:fess_pos/src/platform/location.dart';
import 'package:fess_pos/src/platform/platform_services.dart';
import 'package:fess_pos_engine/fess_pos_engine.dart'
    show compileForm, renderTemplate;
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
          'props': {
            'category': 'external',
            'min_count': 1,
            'max_count': 2,
            'caption': 'required',
          },
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

  /// Draft writes to fail before one succeeds.
  int failDrafts = 0;

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
    List<List<int>> flowPath = const [],
  }) async {
    if (failDrafts > 0) {
      failDrafts--;
      throw StateError('the store is busy');
    }
    drafts.add({'values': values, 'step': currentStep, 'path': flowPath});
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
    final id = _nextId();
    captured.add((field: fieldKey, type: type));
    captions.add(caption);
    return id;
  }

  final List<String?> captions = [];

  @override
  Future<String> recordSignature(
    String inspectionId, {
    required String fieldKey,
    required SignatureCapture signature,
    String? signerName,
    String? signerDesignation,
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

  GeofencePlan? plan;
  final List<({bool passed, int sampled, String method})> checks = [];
  final List<GeofenceChange> changes = [];
  final List<GeoFix> checkins = [];

  @override
  Future<GeofencePlan?> geofencePlan(String inspectionId) async => plan;

  @override
  Future<void> recordLocationCheck(
    String inspectionId, {
    required bool passed,
    required FixVerdict? verdict,
    required int sampledSeconds,
    String method = 'inside_fix',
    GeoFix? checkin,
    Map<String, Object?>? override,
  }) async => checks.add((
    passed: passed,
    sampled: sampledSeconds,
    method: method,
  ));

  @override
  Future<CheckinPlan?> checkinPlan(JobRecord job) async => null;

  @override
  Future<void> recordCheckin(String jobId, GeoFix fix) async =>
      checkins.add(fix);

  final List<({GeoFix fix, bool? inside, String event})> traces = [];

  @override
  Future<void> recordTrace(
    String inspectionId,
    GeoFix fix, {
    bool? inside,
    String event = 'fix',
  }) async => traces.add((fix: fix, inside: inside, event: event));

  @override
  Future<void> recordGeofenceChange(
    String inspectionId,
    GeofenceChange change,
  ) async => changes.add(change);

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

/// The merchant's pin for the fence tests.
const double _pinLat = -26.2041;
const double _pinLng = 28.0473;

GeofencePlan _plan({required bool passed, GeoFix? checkin}) => GeofencePlan(
  fence: Fence.fromResult({
    'profile': 'standalone',
    'job_location': {'lat': _pinLat, 'lng': _pinLng},
    'profile_params': {
      'radius_m': 75,
      'max_accuracy_m': 30,
      'exit_consecutive_fixes': 3,
    },
  })!,
  sampleWindow: const Duration(seconds: 60),
  fixInterval: const Duration(seconds: 20),
  passed: passed,
  outsideFix: const OutsideFixRule(
    maxAccuracyM: 30,
    validFor: Duration(minutes: 20),
  ),
  checkin: checkin,
  overrideWithinM: 150,
);

/// A fix near the pin but too vague to count (±80 m).
LocationFix _vague() => LocationFix(
  latitude: _pinLat,
  longitude: _pinLng,
  accuracyM: 80,
  fixTime: DateTime.utc(2026, 9, 14, 10),
  isMocked: false,
);

/// A fix [metres] north of the pin, accurate to 10 m.
LocationFix _at(double metres) => LocationFix(
  latitude: _pinLat + metres / 111195,
  longitude: _pinLng,
  accuracyM: 10,
  fixTime: DateTime.utc(2026, 9, 14, 10),
  isMocked: false,
);

const Declaration _declaration = Declaration(
  id: _declarationId,
  key: 'agent_declaration',
  version: 1,
  text: 'I visited these premises myself.',
);

List<Override> _overrides(
  _FakeInspections inspections,
  JobRecord job, {
  Map<String, Object?> form = _form,
  Map<String, Object?> flow = _flow,
  Declaration declaration = _declaration,
  LocationProvider? location,
}) => [
  inspectionsProvider.overrideWith((ref) async => inspections),
  jobProvider.overrideWith((ref, id) => Stream.value(job)),
  agentProvider.overrideWith((ref) => Stream.value({'first_name': 'Sipho'})),
  activeDefinitionProvider.overrideWith((ref, key) => Stream.value(null)),
  activeDefinitionVersionProvider.overrideWith(
    (ref, key) => Stream.value(null),
  ),
  jobActionsProvider.overrideWith((ref) async => null),
  definitionVersionProvider.overrideWith(
    (ref, id) async => id == 'form-v' ? form : flow,
  ),
  // In place: a background isolate's answer never arrives in a widget test.
  formCompilerProvider.overrideWithValue((form) async => compileForm(form)),
  declarationProvider.overrideWith((ref, key) => Stream.value(declaration)),
  platformServicesProvider.overrideWithValue(_platform(location: location)),
];

PlatformServices _platform({LocationProvider? location}) {
  final base = fakePlatform();
  return PlatformServices(
    secureStore: base.secureStore,
    connectivity: base.connectivity,
    location: location ?? base.location,
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
          home: ViewPage(view: 'job_detail', jobId: 'j1', onBack: _noop),
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
          home: ViewPage(view: 'job_detail', jobId: 'j1', onBack: _noop),
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
    // The first photo explains the camera before the phone asks (T4-01).
    await tester.tap(find.byKey(const ValueKey('camera-explain-continue')));
    await _settle(tester);
    await tester.tap(find.byKey(const ValueKey('capture-shutter')));
    // The caption box has the focus, and its cursor never settles.
    for (var i = 0; i < 10; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
    // The field asks for a caption; it goes with the photo (T4-04).
    final save = find.byKey(const ValueKey('photo-caption-save'));
    expect(tester.widget<FilledButton>(save).onPressed, isNull);
    await tester.enterText(
      find.byKey(const ValueKey('photo-caption')),
      'The shopfront',
    );
    await tester.pump();
    await tester.tap(save);
    await _settle(tester);
    expect(inspections.captured.single.type, 'photo');
    expect(inspections.captions.single, 'The shopfront');

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

  testWidgets('an acceptance of an earlier declaration version holds the '
      'step until the new one is accepted (T4-06)', (tester) async {
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
        values: const {
          'merchant_confirm': 'Joe Spaza',
          'agent_declaration': {
            'accepted': true,
            'declaration_version_id': '0192d4e0-7c1a-7b2e-9f00-0000000000d0',
            'accepted_at': '2026-09-13T10:00:00+02:00',
          },
        },
        otherText: const {},
        // Among the pages shown: details, photos, the declaration, submit.
        currentStep: 2,
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
    expect(find.text('Step 3 of 4'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('declaration-newer-agent_declaration')),
      findsOneWidget,
    );
    expect(find.text('Version 1'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('inspection-next')));
    await _settle(tester);
    expect(find.text(_copy('inspection.declaration_changed')), findsOneWidget);
    expect(find.text('Step 3 of 4'), findsOneWidget, reason: 'held');

    await tester.tap(
      find.byKey(const ValueKey('declaration-accept-agent_declaration')),
    );
    await tester.tap(find.byKey(const ValueKey('inspection-next')));
    await _settle(tester);
    expect(find.text('Step 4 of 4'), findsOneWidget);
  });

  group('the location check (T4-07)', () {
    Future<(_FakeInspections, FakeLocation)> open(
      WidgetTester tester, {
      required bool passed,
      GeoFix? checkin,
      bool? precise = true,
    }) async {
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
          values: const {},
          otherText: const {},
          currentStep: 0,
          startedAtDevice: record.startedAtDevice,
          locationPassed: passed,
        ),
      )..plan = _plan(passed: passed, checkin: checkin);
      final location = FakeLocation()..preciseState = precise;
      await tester.pumpWidget(
        ProviderScope(
          overrides: _overrides(
            inspections,
            _job('in_progress'),
            location: location,
          ),
          child: MaterialApp(
            home: InspectionPage(
              job: _job('in_progress'),
              inspectionId: 'insp-1',
            ),
          ),
        ),
      );
      // The check samples on a clock, so the page never settles while it
      // runs.
      for (var i = 0; i < 5; i++) {
        await tester.pump(const Duration(milliseconds: 100));
      }
      return (inspections, location);
    }

    testWidgets('until it has passed it has a page; a fix inside passes it '
        'and moves on', (tester) async {
      final (inspections, location) = await open(tester, passed: false);
      expect(find.text(_copy('location.title')), findsOneWidget);
      expect(find.text('Step 1 of 5'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('inspection-next')));
      await tester.pump();
      expect(find.text(_copy('inspection.location_first')), findsOneWidget);

      location.updates.add(_at(20));
      await _settle(tester);
      expect(inspections.checks.single.passed, isTrue);
      expect(find.text(_copy('location.title')), findsNothing);
      expect(find.text('Step 1 of 4'), findsOneWidget);
    });

    testWidgets('outside when the window closes, it holds and says how far', (
      tester,
    ) async {
      final (inspections, location) = await open(tester, passed: false);
      location.updates.add(_at(300));
      await tester.pump(const Duration(seconds: 61));
      await tester.pump();
      expect(
        find.text(renderTemplate(_copy('location.outside'), {'m': 300})),
        findsOneWidget,
      );
      expect(inspections.checks.single.passed, isFalse);
      await tester.tap(find.byKey(const ValueKey('inspection-next')));
      await tester.pump();
      expect(find.text(_copy('inspection.location_first')), findsOneWidget);
      expect(find.text('Step 1 of 5'), findsOneWidget);
    });

    testWidgets('with no lock inside, the check-in on arrival counts as '
        'the outside fix (T4-23)', (tester) async {
      final (inspections, location) = await open(
        tester,
        passed: false,
        checkin: GeoFix(
          lat: _pinLat,
          lng: _pinLng,
          accuracyM: 15,
          at: DateTime.now(),
          isMocked: false,
        ),
      );
      location.updates.add(_vague());
      await tester.pump(const Duration(seconds: 61));
      await _settle(tester);
      expect(inspections.checks.single.method, 'outside_fix');
      expect(inspections.checks.single.passed, isTrue);
      expect(find.text('Step 1 of 4'), findsOneWidget);
    });

    testWidgets('with no lock and no check-in, the agent can record one '
        'outside (T4-23)', (tester) async {
      final (inspections, location) = await open(tester, passed: false);
      location.updates.add(_vague());
      await tester.pump(const Duration(seconds: 61));
      await tester.pump();
      expect(find.text(_copy('location.no_lock_outside')), findsOneWidget);
      expect(inspections.checks.single.passed, isFalse);

      await tester.tap(find.byKey(const ValueKey('location-record-outside')));
      for (var i = 0; i < 5; i++) {
        await tester.pump(const Duration(milliseconds: 100));
      }
      location.updates.add(_at(20));
      await _settle(tester);
      expect(inspections.checkins, hasLength(1));
      expect(
        (inspections.checks.last.method, inspections.checks.last.passed),
        ('outside_fix', true),
      );
      expect(find.text('Step 1 of 4'), findsOneWidget);
    });

    testWidgets('outside but near enough, it offers an override (T4-10)', (
      tester,
    ) async {
      final (_, location) = await open(tester, passed: false);
      location.updates.add(_at(120));
      await tester.pump(const Duration(seconds: 61));
      await tester.pump();
      expect(find.byKey(const ValueKey('location-override')), findsOneWidget);
      expect(find.text(_copy('location.override_too_far')), findsNothing);
    });

    testWidgets('too far for an override, it says so (T4-10)', (tester) async {
      final (_, location) = await open(tester, passed: false);
      location.updates.add(_at(400));
      await tester.pump(const Duration(seconds: 61));
      await tester.pump();
      expect(find.byKey(const ValueKey('location-override')), findsNothing);
      expect(find.text(_copy('location.override_too_far')), findsOneWidget);
    });

    testWidgets('only approximate location: it says how to allow the precise '
        'one (B3.7, T4-12)', (tester) async {
      await open(tester, passed: false, precise: false);
      expect(find.text(_copy('location.approximate')), findsOneWidget);
      expect(
        find.byKey(const ValueKey('location-open-settings')),
        findsOneWidget,
      );
    });

    testWidgets('leaving the fence pauses the inspection; coming back '
        'resumes it', (tester) async {
      final (inspections, location) = await open(tester, passed: true);
      await _settle(tester);
      expect(find.text('Step 1 of 4'), findsOneWidget);
      for (var i = 0; i < 3; i++) {
        location.updates.add(_at(300));
        await tester.pump();
      }
      await tester.pump();
      expect(find.byKey(const ValueKey('inspection-paused')), findsOneWidget);
      expect(inspections.changes.single.paused, isTrue);
      expect(
        tester
            .widget<FilledButton>(
              find.byKey(const ValueKey('inspection-next')),
            )
            .onPressed,
        isNull,
      );

      location.updates.add(_at(20));
      await _settle(tester);
      expect(find.byKey(const ValueKey('inspection-paused')), findsNothing);
      expect(inspections.changes.last.paused, isFalse);
      // Every fix watched is a breadcrumb (T4-08).
      expect(inspections.traces.map((t) => t.inside), [
        false,
        false,
        false,
        true,
      ]);
    });
  });

  testWidgets('leaving the app writes the draft at once, and a failed write '
      'is tried again (T3-06)', (tester) async {
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
    List<Object?> written() => [
      for (final d in inspections.drafts) d['values'],
    ];

    await tester.enterText(find.byType(TextField), 'Joe');
    await tester.pump();
    expect(
      written().where((v) => (v! as Map).isNotEmpty),
      isEmpty,
      reason: 'typing waits a moment',
    );
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    await tester.pump();
    expect(written().last, {'merchant_confirm': 'Joe'});
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);

    inspections.failDrafts = 1;
    await tester.enterText(find.byType(TextField), 'Joe Spaza');
    await tester.pump(const Duration(milliseconds: 400));
    expect(written().last, {'merchant_confirm': 'Joe'}, reason: 'it failed');
    await tester.pump(const Duration(seconds: 2));
    expect(written().last, {'merchant_confirm': 'Joe Spaza'});
  });

  group('the full flow runner (T3-04)', () {
    const smallForm = <String, Object?>{
      'kind': 'form',
      'family': 'site_inspection',
      'sections': [
        {
          'key': 's1',
          'title': 'Business',
          'fields': [
            {
              'key': 'name',
              'type': 'text',
              'label': 'Business name',
              'required': true,
            },
          ],
        },
        {
          'key': 's2',
          'title': 'Trading',
          'fields': [
            {
              'key': 'open',
              'type': 'boolean',
              'label': 'Open now?',
              'required': true,
              'risk_indicator': {
                'when': {
                  '==': [
                    {'var': 'answers.open'},
                    false,
                  ],
                },
                'level': 'high',
              },
            },
          ],
        },
      ],
    };

    Future<_FakeInspections> show(
      WidgetTester tester,
      Map<String, Object?> flow,
    ) async {
      final inspections = _FakeInspections(_record());
      await tester.pumpWidget(
        ProviderScope(
          overrides: _overrides(
            inspections,
            _job('in_progress'),
            form: smallForm,
            flow: flow,
          ),
          child: MaterialApp(
            home: InspectionPage(
              job: _job('in_progress'),
              inspectionId: 'insp-1',
            ),
          ),
        ),
      );
      await _settle(tester);
      return inspections;
    }

    Future<void> next(WidgetTester tester) async {
      await tester.tap(find.byKey(const ValueKey('inspection-next')));
      await _settle(tester);
    }

    testWidgets('a briefing to acknowledge, a page per section, and a '
        'review that jumps back', (tester) async {
      final inspections = await show(tester, const {
        'kind': 'flow',
        'steps': [
          {
            'id': 'briefing',
            'type': 'job_briefing',
            'view': 'job_detail',
            'acknowledgement_text': 'I have read the job details',
          },
          {'id': 'location', 'type': 'location_check'},
          {
            'id': 'business',
            'type': 'form',
            'sections': ['s1', 's2'],
            'paging': 'section_per_page',
          },
          {
            'id': 'review',
            'type': 'summary_review',
            'show_risk_indicators': true,
            'allow_jump_back': true,
          },
          {'id': 'submit', 'type': 'submit', 'label': 'Submit inspection'},
          {'id': 'receipt', 'type': 'receipt', 'view': 'receipt'},
        ],
      });
      expect(find.text('Step 1 of 5'), findsOneWidget);
      await next(tester);
      expect(find.text(_copy('inspection.acknowledge_first')), findsOneWidget);
      // Below the job's details, as on a phone.
      final ack = find.byKey(const ValueKey('briefing-ack-0'));
      await tester.ensureVisible(ack);
      await tester.pump();
      await tester.tap(ack);
      await next(tester);

      expect(find.text('Step 2 of 5'), findsOneWidget);
      expect(find.text('Business name *'), findsOneWidget);
      expect(find.text('Open now? *'), findsNothing, reason: 'its own page');
      await tester.enterText(find.byType(TextField), 'Joe Spaza');
      await next(tester);
      expect(find.text('Step 3 of 5'), findsOneWidget);
      await tester.tap(find.text('No'));
      await next(tester);

      expect(find.text('Step 4 of 5'), findsOneWidget);
      expect(
        tester.widget<Text>(find.byKey(const ValueKey('summary-name'))).data,
        'Joe Spaza',
      );
      expect(find.byKey(const ValueKey('summary-risk-open')), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('summary-edit-s1')));
      await _settle(tester);
      expect(find.text('Step 2 of 5'), findsOneWidget);
      expect(find.widgetWithText(TextField, 'Joe Spaza'), findsOneWidget);

      await next(tester);
      await next(tester);
      await next(tester);
      expect(find.text('Step 5 of 5'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('inspection-submit')));
      await _settle(tester);
      await tester.tap(find.byKey(const ValueKey('inspection-submit-confirm')));
      await _settle(tester);
      expect(inspections.submitted!.keys, {'name', 'open'});
      expect(
        inspections.drafts.last['path'],
        isNotEmpty,
        reason: 'the way through is kept with the draft',
      );
    });

    testWidgets('a branch to a flow this build cannot open says so', (
      tester,
    ) async {
      await show(tester, const {
        'kind': 'flow',
        'steps': [
          {
            'id': 'trading',
            'type': 'form',
            'sections': ['s2'],
            'next': {
              'if': [
                {
                  '==': [
                    {'var': 'answers.open'},
                    false,
                  ],
                },
                'flow:unable_to_complete_flow',
                null,
              ],
            },
          },
          {
            'id': 'business',
            'type': 'form',
            'sections': ['s1'],
          },
          {'id': 'submit', 'type': 'submit'},
        ],
      });
      await tester.tap(find.text('No'));
      await next(tester);
      expect(find.text(_copy('inspection.branch_unavailable')), findsOneWidget);
      expect(find.text('Step 1 of 3'), findsOneWidget);
      await tester.tap(find.text('Yes'));
      await next(tester);
      expect(find.text('Step 2 of 3'), findsOneWidget);
    });
  });
}
