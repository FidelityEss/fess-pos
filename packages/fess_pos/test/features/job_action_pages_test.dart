import 'dart:async';

import 'package:fess_pos/src/core/content/bundled_copy.dart';
import 'package:fess_pos/src/core/di/providers.dart';
import 'package:fess_pos/src/domain/forms/reason_codes.dart';
import 'package:fess_pos/src/domain/jobs/job_actions.dart';
import 'package:fess_pos/src/domain/jobs/job_record.dart';
import 'package:fess_pos/src/features/jobs/job_pages.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

/// Records what the pages ask for; delivery moves when told.
class _FakeActions implements JobActions {
  final List<({JobAction action, ReasonSubmission? reason})> calls = [];
  JobActionResult next = const JobActionResult.recorded('env-1');

  /// What the first send achieves; null leaves the envelope waiting.
  DeliveryState? deliverOnSend;
  DeliveryState _current = DeliveryState.waiting;
  final StreamController<DeliveryState> _changes = StreamController.broadcast();

  void deliver(DeliveryState state) {
    _current = state;
    _changes.add(state);
  }

  @override
  Future<JobActionResult> record(
    JobRecord job,
    JobAction action, {
    ReasonSubmission? reason,
  }) async {
    calls.add((action: action, reason: reason));
    return next;
  }

  @override
  Future<void> sendNow() async {
    final d = deliverOnSend;
    if (d != null) deliver(d);
  }

  @override
  Stream<DeliveryState> watchDelivery(String envelopeId) => Stream.multi((c) {
    c.add(_current);
    final sub = _changes.stream.listen(c.add);
    c.onCancel = sub.cancel;
  });
}

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

/// The seeded `assignment_reject` form, without its note rule: here the
/// reason code's own `requires_note` asks for the note.
const Map<String, Object?> _rejectForm = {
  'kind': 'form',
  'family': 'assignment_reject',
  'sections': [
    {
      'key': 'reason',
      'title': "Why can't you take this job?",
      'fields': [
        {
          'key': 'reason_code',
          'type': 'single_select',
          'display': 'radio',
          'label': 'Reason',
          'required': true,
          'options_source': {
            'type': 'reason_codes',
            'category': 'assignment_reject',
          },
        },
        {
          'key': 'note',
          'type': 'textarea',
          'label': 'Note',
          'props': {'rows': 3, 'max_length': 1000},
        },
      ],
    },
  ],
};

const List<ReasonCode> _codes = [
  ReasonCode(
    category: 'assignment_reject',
    code: 'too_far',
    label: 'Too far away',
  ),
  ReasonCode(
    category: 'assignment_reject',
    code: 'conflict',
    label: 'Conflict of interest',
    requiresNote: true,
    sortOrder: 1,
  ),
];

const Map<String, Object?> _appDefinition = {
  'home': 'job_detail',
  'pages': {
    'job_detail': {
      'type': 'view_page',
      'view': 'job_detail',
      'actions': [
        {
          'label': 'Decline',
          'target': {'page': 'reject_job'},
        },
      ],
    },
    'reject_job': {
      'type': 'form_page',
      'title': 'Decline this job',
      'form': 'assignment_reject',
      'action': 'job.reject',
      'outcomes': 'default',
    },
    'outcome_success': {
      'type': 'outcome_page',
      'outcome': 'success',
      'title': 'All done',
      'message': 'The office has it.',
      'buttons': [
        {'label': 'Home', 'action': 'home'},
      ],
    },
    // A checked app names every outcome (T3-17); these two show the
    // bundled copy.
    'outcome_saved': {'type': 'outcome_page', 'outcome': 'saved'},
    'outcome_failure': {'type': 'outcome_page', 'outcome': 'failure'},
  },
  'outcome_sets': {
    'default': {
      'success': 'outcome_success',
      'saved': 'outcome_saved',
      'failure': 'outcome_failure',
    },
  },
};

void _noop() {}

Widget _host(
  JobRecord job,
  _FakeActions actions, {
  Map<String, Object?>? app,
}) => ProviderScope(
  overrides: [
    jobProvider.overrideWith((ref, id) => Stream.value(job)),
    agentProvider.overrideWith((ref) => Stream.value({'first_name': 'Sipho'})),
    activeDefinitionProvider.overrideWith(
      (ref, key) => Stream.value(
        key.kind == 'app' && key.key == 'agent_app' ? app : null,
      ),
    ),
    activeDefinitionVersionProvider.overrideWith(
      (ref, key) => Stream.value(
        key.kind == 'form' && key.key == 'assignment_reject'
            ? ActiveDefinition(
                versionId: 'v-1',
                hash: 'h' * 64,
                body: _rejectForm,
              )
            : null,
      ),
    ),
    reasonCodesProvider.overrideWith((ref) => Stream.value(_codes)),
    jobActionsProvider.overrideWith((ref) async => actions),
  ],
  child: const MaterialApp(
    home: ViewPage(view: 'job_detail', jobId: 'j1', onBack: _noop),
  ),
);

String _copy(String key) => BundledCopy.text(key);

const ValueKey<String> _accept = ValueKey('job-action-accept');
const ValueKey<String> _reject = ValueKey('job-action-reject');
const ValueKey<String> _unable = ValueKey('job-action-unable');
const ValueKey<String> _submit = ValueKey('reason-form-submit');

void main() {
  testWidgets('an assigned job offers accept and "can\'t take it"', (
    tester,
  ) async {
    await tester.pumpWidget(_host(_job('assigned'), _FakeActions()));
    await tester.pumpAndSettle();
    expect(find.byKey(_accept), findsOneWidget);
    expect(find.text(_copy('job.action.accept')), findsOneWidget);
    expect(find.byKey(_reject), findsOneWidget);
    expect(find.byKey(_unable), findsNothing);
  });

  testWidgets('accepting shows the server’s receipt, then goes home', (
    tester,
  ) async {
    final actions = _FakeActions()..deliverOnSend = DeliveryState.delivered;
    await tester.pumpWidget(_host(_job('assigned'), actions));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(_accept));
    await tester.pumpAndSettle();
    expect(actions.calls.single.action, JobAction.accept);
    expect(find.text(_copy('outcome.success.title')), findsOneWidget);
    await tester.tap(find.text(_copy('outcome.home')));
    await tester.pumpAndSettle();
    expect(find.text(_copy('outcome.success.title')), findsNothing);
    expect(find.byKey(_accept), findsOneWidget, reason: 'back on the job');
  });

  testWidgets('offline it is saved on the phone; a later receipt shows', (
    tester,
  ) async {
    final actions = _FakeActions();
    await tester.pumpWidget(_host(_job('assigned'), actions));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(_accept));
    await tester.pumpAndSettle();
    expect(find.text(_copy('outcome.saved.title')), findsOneWidget);
    actions.deliver(DeliveryState.delivered);
    await tester.pumpAndSettle();
    expect(find.text(_copy('outcome.success.title')), findsOneWidget);
  });

  testWidgets(
    'the reason form asks for a reason, and a note where the reason needs one',
    (tester) async {
      final actions = _FakeActions();
      await tester.pumpWidget(_host(_job('assigned'), actions));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(_reject));
      await tester.pumpAndSettle();
      expect(find.text("Why can't you take this job?"), findsOneWidget);
      expect(find.text(_copy('job.action.reject.title')), findsOneWidget);

      await tester.tap(find.byKey(_submit));
      await tester.pumpAndSettle();
      expect(find.text(_copy('form.error.REQUIRED')), findsOneWidget);

      await tester.tap(find.text('Conflict of interest'));
      await tester.tap(find.byKey(_submit));
      await tester.pumpAndSettle();
      expect(find.text(_copy('form.error.NOTE_REQUIRED')), findsOneWidget);
      expect(actions.calls, isEmpty);

      await tester.enterText(find.byType(TextField), 'My cousin');
      await tester.tap(find.byKey(_submit));
      await tester.pumpAndSettle();
      final call = actions.calls.single;
      expect(call.action, JobAction.reject);
      expect(call.reason!.reasonCode, 'conflict');
      expect(call.reason!.note, 'My cousin');
      expect(call.reason!.formVersionId, 'v-1');
      expect(call.reason!.definitionHash, 'h' * 64);
      expect(call.reason!.answers, {
        'reason_code': {'v': 'conflict'},
        'note': {'v': 'My cousin'},
      });
      expect(find.text(_copy('outcome.saved.title')), findsOneWidget);
    },
  );

  testWidgets('labels, titles and outcomes come from the app definition', (
    tester,
  ) async {
    final actions = _FakeActions()..deliverOnSend = DeliveryState.delivered;
    await tester.pumpWidget(
      _host(_job('assigned'), actions, app: _appDefinition),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Decline'));
    await tester.pumpAndSettle();
    expect(find.text('Decline this job'), findsOneWidget);
    await tester.tap(find.text('Too far away'));
    await tester.tap(find.byKey(_submit));
    await tester.pumpAndSettle();
    expect(actions.calls.single.reason!.reasonCode, 'too_far');
    expect(find.text('All done'), findsOneWidget);
    expect(find.text('The office has it.'), findsOneWidget);
    expect(find.text('Home'), findsOneWidget);
  });

  testWidgets('an accepted job offers unable; its form must be on the phone', (
    tester,
  ) async {
    await tester.pumpWidget(_host(_job('accepted'), _FakeActions()));
    await tester.pumpAndSettle();
    expect(find.byKey(_accept), findsNothing);
    expect(find.byKey(_reject), findsNothing);
    await tester.tap(find.byKey(_unable));
    await tester.pumpAndSettle();
    expect(find.text(_copy('job.action.form_missing')), findsOneWidget);
  });

  testWidgets('an action the phone no longer allows ends as not done', (
    tester,
  ) async {
    final actions = _FakeActions()..next = const JobActionResult.notAllowed();
    await tester.pumpWidget(_host(_job('assigned'), actions));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(_accept));
    await tester.pumpAndSettle();
    expect(find.text(_copy('outcome.failure.title')), findsOneWidget);
    expect(find.text(_copy('job.action.not_allowed')), findsOneWidget);
  });
}
