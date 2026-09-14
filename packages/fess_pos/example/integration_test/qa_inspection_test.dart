// The walking-skeleton inspection on QA (T4-27), in three runs of this file so
// the app really stops in between:
//
//   1. start   (online)  accept the job, begin, answer the first step, photo
//   2. finish  (airplane mode, app restarted) continue where it stopped,
//              sign, declare, submit: saved on the phone
//   3. deliver (online)  sync until the photos are verified and the job is
//              under review
//
//   flutter test integration_test/qa_inspection_test.dart -d <device> \
//     --dart-define-from-file=$HOME/.fess-pos/module-harness-qa.json \
//     --dart-define=POS_SKELETON_PHASE=start
//
// The job comes from `tools/scenarios/skeleton.ts setup`; its `check` shows
// what reached the server. QA only; skipped without the harness defines. It
// prints what it does (lines starting POS_SKELETON).
// It reads the module's local store to follow delivery, as no host would.
// ignore_for_file: implementation_imports
import 'package:fess_pos/fess_pos.dart';
import 'package:fess_pos/src/core/runtime/module_runtime.dart';
import 'package:fess_pos/src/data/local/pos_database.dart';
import 'package:fess_pos_example/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

const String _phase = String.fromEnvironment(
  'POS_SKELETON_PHASE',
  defaultValue: 'start',
);

void _log(String message) => debugPrint('POS_SKELETON $_phase: $message');

/// Pumps until [finder] finds something, or [timeout].
Future<bool> _waitFor(
  WidgetTester tester,
  Finder finder, {
  Duration timeout = const Duration(seconds: 60),
}) async {
  final end = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(end)) {
    if (finder.evaluate().isNotEmpty) return true;
    await tester.pump(const Duration(milliseconds: 300));
  }
  return finder.evaluate().isNotEmpty;
}

Future<void> _pumpFor(WidgetTester tester, Duration d) async {
  final end = DateTime.now().add(d);
  while (DateTime.now().isBefore(end)) {
    await tester.pump(const Duration(milliseconds: 200));
  }
}

Future<void> _tap(WidgetTester tester, Finder finder) async {
  expect(await _waitFor(tester, finder), isTrue, reason: '$finder');
  await tester.ensureVisible(finder);
  await tester.pump();
  await tester.tap(finder);
  await _pumpFor(tester, const Duration(milliseconds: 800));
}

/// The newest skeleton job on the phone in one of [statuses].
Future<JobRow?> _job(PosDatabase db, Set<String> statuses) async {
  final rows = [
    for (final r in await db.select(db.jobs).get())
      if (r.assignedToMe &&
          r.body.contains('Walking Skeleton Spaza') &&
          statuses.contains(r.status))
        r,
  ]..sort((a, b) => b.reference.compareTo(a.reference));
  return rows.firstOrNull;
}

Future<InspectionRow?> _inspection(PosDatabase db, String jobId) async {
  final rows = [
    for (final r in await db.select(db.inspections).get())
      if (r.jobId == jobId) r,
  ]..sort((a, b) => b.attempt.compareTo(a.attempt));
  return rows.firstOrNull;
}

Future<List<EvidenceRow>> _evidence(
  PosDatabase db,
  String inspectionId,
) async => [
  for (final e in await db.select(db.evidence).get())
    if (e.inspectionId == inspectionId) e,
];

/// The flow step on screen, from its `inspection-step-N` key; -1 for none.
int _stepOnScreen() {
  for (var i = 0; i < 10; i++) {
    if (find.byKey(ValueKey('inspection-step-$i')).evaluate().isNotEmpty) {
      return i;
    }
  }
  return -1;
}

/// Every text on screen, for when a step won't move on.
void _screen(WidgetTester tester, String label) {
  final texts = tester
      .widgetList<Text>(find.byType(Text))
      .map((t) => t.data)
      .whereType<String>()
      .map((s) => s.replaceAll('\n', ' / '));
  _log('$label: ${texts.join(' | ')}');
}

/// Taps Next and waits for step [to]; shows the screen if it holds.
Future<void> _next(WidgetTester tester, int to) async {
  await _tap(tester, find.byKey(const ValueKey('inspection-next')));
  final moved = await _waitFor(
    tester,
    find.byKey(ValueKey('inspection-step-$to')),
    timeout: const Duration(seconds: 15),
  );
  if (!moved) _screen(tester, 'held before step $to');
  expect(moved, isTrue, reason: 'on to step $to');
}

/// Draws a signature and waits until it's stored and answered: storing
/// waits a few seconds for a location fix, and the field says "Saving…".
Future<void> _sign(
  WidgetTester tester,
  PosDatabase db,
  String inspectionId,
) async {
  await _tap(
    tester,
    find.byKey(const ValueKey('signature-sign-interviewee_signature')),
  );
  final pad = find.byKey(const ValueKey('signature-pad'));
  expect(await _waitFor(tester, pad), isTrue);
  await tester.drag(pad, const Offset(160, 40));
  await tester.drag(pad, const Offset(-80, 60));
  await _pumpFor(tester, const Duration(milliseconds: 500));
  await _tap(tester, find.byKey(const ValueKey('signature-done')));
  expect(
    await _waitFor(
      tester,
      find.text('Sign again'),
      timeout: const Duration(seconds: 30),
    ),
    isTrue,
    reason: 'the signature is stored and answered',
  );
  final stored = [
    for (final e in await _evidence(db, inspectionId))
      if (e.type == 'signature') e,
  ];
  _log('signature stored: ${stored.length} on the phone');
}

Future<void> _openJob(WidgetTester tester, String jobId) async {
  final card = find.byKey(ValueKey('job-$jobId'));
  expect(await _waitFor(tester, card), isTrue, reason: 'job card on home');
  await tester.scrollUntilVisible(
    card,
    300,
    scrollable: find.byType(Scrollable).first,
  );
  await _tap(tester, card);
}

Future<void> _start(WidgetTester tester, ModuleRuntime runtime) async {
  final db = await runtime.localStore();
  JobRow? job;
  for (var i = 0; i < 60 && job == null; i++) {
    await runtime.runSync(keepRunning: false);
    job = await _job(db, {'assigned', 'accepted'});
    if (job == null) await _pumpFor(tester, const Duration(seconds: 1));
  }
  expect(job, isNotNull, reason: 'run tools/scenarios/skeleton.ts setup');
  _log('job ${job!.reference} is ${job.status}');
  await _pumpFor(tester, const Duration(seconds: 2));
  await _openJob(tester, job.id);

  if (find.byKey(const ValueKey('job-action-accept')).evaluate().isNotEmpty) {
    await _tap(tester, find.byKey(const ValueKey('job-action-accept')));
    expect(
      await _waitFor(tester, find.byKey(const ValueKey('outcome-success'))),
      isTrue,
      reason: 'the accept reached QA',
    );
    _log('accepted');
    tester
        .state<NavigatorState>(find.byType(Navigator).last)
        .popUntil((r) => r.isFirst);
    await _pumpFor(tester, const Duration(seconds: 1));
    await _openJob(tester, job.id);
  }

  await _tap(tester, find.byKey(const ValueKey('job-action-begin')));
  expect(
    await _waitFor(tester, find.byKey(const ValueKey('inspection-step-0'))),
    isTrue,
    reason: 'the inspection began',
  );
  final inspection = (await _inspection(db, job.id))!;
  _log(
    'began inspection ${inspection.id} (attempt ${inspection.attempt}, '
    'token ${inspection.sessionTokenId == null ? 'missing' : 'used'}, '
    'geofence ${inspection.geofence})',
  );

  await tester.enterText(find.byType(TextField).first, 'Walking Skeleton');
  await _tap(tester, find.text('Shop'));
  await _tap(tester, find.byKey(const ValueKey('inspection-next')));
  expect(
    await _waitFor(tester, find.byKey(const ValueKey('inspection-step-1'))),
    isTrue,
  );

  await _tap(tester, find.byKey(const ValueKey('photo-take-external_photos')));
  // The first photo on a phone explains the camera before the system asks
  // (T4-01); the app remembers it after that.
  const explain = ValueKey('camera-explain-continue');
  if (await _waitFor(
    tester,
    find.byKey(explain),
    timeout: const Duration(seconds: 5),
  )) {
    await _tap(tester, find.byKey(explain));
  }
  expect(
    await _waitFor(
      tester,
      find.byKey(const ValueKey('capture-shutter')),
      timeout: const Duration(seconds: 30),
    ),
    isTrue,
    reason: 'the camera opened',
  );
  await _pumpFor(tester, const Duration(seconds: 2));
  await _tap(tester, find.byKey(const ValueKey('capture-shutter')));
  expect(
    await _waitFor(
      tester,
      find.byKey(const ValueKey('photo-take-external_photos')),
      timeout: const Duration(seconds: 30),
    ),
    isTrue,
  );
  // Storing waits a few seconds for a location fix to go with the photo.
  var evidence = <EvidenceRow>[];
  for (var i = 0; i < 60 && evidence.isEmpty; i++) {
    await _pumpFor(tester, const Duration(milliseconds: 500));
    evidence = await _evidence(db, inspection.id);
  }
  expect(evidence, hasLength(1), reason: 'the photo is stored');
  await _pumpFor(tester, const Duration(seconds: 1));
  _log(
    'photo stored: ${evidence.single.size} B, sha256 '
    '${evidence.single.sha256.substring(0, 12)}…',
  );
  final draft = (await _inspection(db, job.id))!;
  _log('draft at step ${draft.currentStep}: ${draft.draft}');
  _log('stopping here; next: airplane mode, then the finish phase');
}

Future<void> _finish(WidgetTester tester, ModuleRuntime runtime) async {
  final db = await runtime.localStore();
  final job = await _job(db, {'in_progress'});
  expect(job, isNotNull, reason: 'the start phase began an inspection');
  final before = (await _inspection(db, job!.id))!;
  _log('after the restart: inspection at step ${before.currentStep}');
  // What the phone holds that the declaration step needs.
  final held = [
    for (final d in await db.select(db.cachedDocuments).get())
      if (d.key.startsWith('declaration:') ||
          d.key.startsWith('session_token:'))
        d.key.split(':').first,
  ];
  _log('held: ${held.isEmpty ? 'no declarations or tokens' : held.join(', ')}');
  expect(
    before.draft.contains('external_photos'),
    isTrue,
    reason: 'the photo taken before the restart is still answered',
  );
  await _pumpFor(tester, const Duration(seconds: 2));
  await _openJob(tester, job.id);
  await _tap(tester, find.byKey(const ValueKey('job-action-continue')));
  expect(
    await _waitFor(
      tester,
      find.byKey(ValueKey('inspection-step-${before.currentStep}')),
    ),
    isTrue,
    reason: 'it resumed where it stopped',
  );

  // An agent can stop on any step: do what the step on screen asks.
  for (var guard = 0; guard < 8; guard++) {
    final step = _stepOnScreen();
    _log('on step $step');
    if (find.byKey(const ValueKey('inspection-submit')).evaluate().isNotEmpty) {
      break;
    }
    final accept = find.byKey(
      const ValueKey('declaration-accept-agent_declaration'),
    );
    final signature = find.byKey(
      const ValueKey('signature-sign-interviewee_signature'),
    );
    if (accept.evaluate().isNotEmpty) {
      if (!(tester.widget<CheckboxListTile>(accept).value ?? false)) {
        await _tap(tester, accept);
      }
    } else if (signature.evaluate().isNotEmpty) {
      final name = find.byType(TextField).first;
      if (tester.widget<TextField>(name).controller?.text.isEmpty ?? true) {
        await tester.enterText(name, 'Thandi Test');
      }
      if (find.text('Sign again').evaluate().isEmpty) {
        await _sign(tester, db, before.id);
      }
    } else if (find
        .byKey(const ValueKey('photo-take-external_photos'))
        .evaluate()
        .isEmpty) {
      _screen(tester, 'unknown step');
      fail('step $step: nothing this test knows how to answer');
    }
    await _next(tester, step + 1);
  }
  await _tap(tester, find.byKey(const ValueKey('inspection-submit')));
  await _tap(tester, find.byKey(const ValueKey('inspection-submit-confirm')));
  expect(
    await _waitFor(
      tester,
      find.byWidgetPredicate(
        (w) =>
            w.key == const ValueKey('outcome-saved') ||
            w.key == const ValueKey('outcome-success'),
      ),
    ),
    isTrue,
    reason: 'the submission is recorded',
  );
  final submissions = [
    for (final o in await db.select(db.outbox).get())
      if (o.type == 'submission' && o.entityRef == 'job:${job.id}') o.state,
  ];
  final evidence = [
    for (final e in await _evidence(db, before.id)) '${e.type}:${e.state}',
  ];
  _log(
    'submitted: ${submissions.join(', ')} (offline: saved on the phone); '
    'evidence ${evidence.join(', ')}',
  );
}

Future<void> _deliver(WidgetTester tester, ModuleRuntime runtime) async {
  final db = await runtime.localStore();
  final job = await _job(db, {'in_progress', 'submitted', 'under_review'});
  expect(job, isNotNull);
  final inspection = (await _inspection(db, job!.id))!;
  for (var i = 0; i < 40; i++) {
    await runtime.runSync(keepRunning: false);
    final evidence = await _evidence(db, inspection.id);
    final ids = {for (final e in evidence) 'evidence:${e.id}'};
    final waiting = [
      for (final o in await db.select(db.outbox).get())
        if ((o.entityRef == 'job:${job.id}' || ids.contains(o.entityRef)) &&
            (o.state == 'queued' || o.state == 'in_flight'))
          o.type,
    ];
    final status = [
      for (final j in await db.select(db.jobs).get())
        if (j.id == job.id) j.status,
    ].single;
    _log(
      'job $status; evidence ${evidence.map((e) => e.state).join(', ')}; '
      'waiting: ${waiting.isEmpty ? 'nothing' : waiting.join(', ')}',
    );
    if (status == 'under_review' &&
        evidence.every((e) => e.state == 'verified' && e.bytes == null) &&
        waiting.isEmpty) {
      _log('delivered: every item verified on QA, the job is under review');
      return;
    }
    await _pumpFor(tester, const Duration(seconds: 5));
  }
  fail('not delivered within the wait');
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  final identity = harnessIdentity();

  testWidgets(
    'QA walking skeleton: $_phase',
    (tester) async {
      expect(
        const String.fromEnvironment('POS_ENVIRONMENT'),
        'qa',
        reason: 'QA only, never production',
      );
      await PosModule.initialize(PosHostConfig(bootstrap: harnessBootstrap()));
      expect((await PosModule.signIn(identity!)).visible, isTrue);
      await tester.pumpWidget(
        MaterialApp(home: Builder(builder: (_) => PosModule.entryPoint())),
      );
      await _pumpFor(tester, const Duration(seconds: 1));
      final runtime = ModuleRuntime.current!;
      switch (_phase) {
        case 'start':
          await _start(tester, runtime);
        case 'finish':
          await _finish(tester, runtime);
        case 'deliver':
          await _deliver(tester, runtime);
        default:
          fail('POS_SKELETON_PHASE must be start, finish or deliver');
      }
    },
    skip: identity == null,
    timeout: const Timeout(Duration(minutes: 10)),
  );
}
