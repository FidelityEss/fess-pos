import 'dart:async';

import 'package:fess_pos/src/core/di/providers.dart';
import 'package:fess_pos/src/domain/app/app_spec.dart';
import 'package:fess_pos/src/domain/forms/form_submissions.dart';
import 'package:fess_pos/src/domain/jobs/job_actions.dart';
import 'package:fess_pos/src/domain/jobs/job_record.dart';
import 'package:fess_pos/src/features/forms/record_form_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

class _FakeSubmissions implements FormSubmissions {
  final List<FormSubmission> submitted = [];
  JobActionResult result = const JobActionResult.recorded('env-1');
  final StreamController<DeliveryState> delivery = StreamController.broadcast();

  @override
  Future<JobActionResult> submit(FormSubmission submission) async {
    submitted.add(submission);
    return result;
  }

  @override
  Future<void> sendNow() async {}

  @override
  Stream<DeliveryState> watchDelivery(String envelopeId) => delivery.stream;
}

const JobRecord _job = JobRecord(
  id: 'j1',
  reference: 'POS-j1',
  status: 'accepted',
  assignedToMe: true,
  data: {'id': 'j1', 'reference': 'POS-j1', 'merchant_name': 'Joe Spaza'},
);

const Map<String, Object?> _form = {
  'sections': [
    {
      'key': 's',
      'fields': [
        {
          'key': 'spoke_to',
          'type': 'text',
          'label': 'Who did you speak to?',
          'required': true,
        },
      ],
    },
  ],
};

const Map<String, Object?> _followup = {
  'type': 'form_page',
  'title': 'Follow-up for {{job.reference}}',
  'form': 'merchant_followup',
  'action': 'record.submit',
  'subject': 'job',
  'outcomes': 'followup_done',
};

/// A checked app, so its outcome set is the one in force.
const Map<String, Object?> _app = {
  'home': 'home',
  'pages': {
    'home': {'type': 'view_page', 'view': 'home'},
    'followup': _followup,
    'done_success': {
      'type': 'outcome_page',
      'outcome': 'success',
      'title': 'Sent',
    },
    'done_saved': {
      'type': 'outcome_page',
      'outcome': 'saved',
      'title': 'Saved here',
      'message': '{{pending}} waiting to send.',
    },
    'done_failure': {
      'type': 'outcome_page',
      'outcome': 'failure',
      'title': 'Not sent',
      'buttons': [
        {'label': 'Try again', 'action': 'retry'},
      ],
    },
  },
  'outcome_sets': {
    'followup_done': {
      'success': 'done_success',
      'saved': 'done_saved',
      'failure': 'done_failure',
    },
  },
};

Widget _host(
  _FakeSubmissions submissions, {
  Map<String, Object?> page = _followup,
  String? jobId = 'j1',
}) => ProviderScope(
  overrides: [
    jobProvider.overrideWith((ref, id) => Stream.value(_job)),
    agentProvider.overrideWith((ref) => Stream.value({'first_name': 'Sipho'})),
    activeDefinitionProvider.overrideWith(
      (ref, key) => Stream.value(key.kind == 'app' ? _app : null),
    ),
    activeDefinitionVersionProvider.overrideWith(
      (ref, key) => Stream.value(
        key.kind == 'form' && key.key == 'merchant_followup'
            ? ActiveDefinition(versionId: 'v-1', hash: 'h' * 64, body: _form)
            : null,
      ),
    ),
    formSubmissionsProvider.overrideWith((ref) async => submissions),
  ],
  child: MaterialApp(
    home: RecordFormPage(page: AppPage('followup', page), jobId: jobId),
  ),
);

const ValueKey<String> _submit = ValueKey('record-form-submit');

void main() {
  testWidgets('the generic form page checks the answers, records them '
      "against its job and ends on the page's outcome set (T3-19)", (
    tester,
  ) async {
    final submissions = _FakeSubmissions();
    await tester.pumpWidget(_host(submissions));
    await tester.pumpAndSettle();
    expect(find.text('Follow-up for POS-j1'), findsOneWidget);

    await tester.tap(find.byKey(_submit));
    await tester.pumpAndSettle();
    expect(submissions.submitted, isEmpty, reason: 'a required answer');

    await tester.enterText(find.byType(TextField), 'Owner');
    await tester.tap(find.byKey(_submit));
    await tester.pumpAndSettle();
    final sent = submissions.submitted.single;
    expect(sent.subject, SubmissionSubject.job);
    expect(sent.jobId, 'j1');
    expect(sent.formVersionId, 'v-1');
    expect(sent.answers['spoke_to'], {'v': 'Owner'});
    expect(
      (sent.contextSnapshot['job']! as Map<String, Object?>)['reference'],
      'POS-j1',
    );
    expect(find.text('Saved here'), findsOneWidget);
    expect(find.text('0 waiting to send.'), findsOneWidget);

    submissions.delivery.add(DeliveryState.delivered);
    await tester.pumpAndSettle();
    expect(find.text('Sent'), findsOneWidget);
  });

  testWidgets('nothing recorded: the outcome opens over the form, and '
      'trying again comes back to the answers', (tester) async {
    final submissions = _FakeSubmissions()
      ..result = const JobActionResult.unavailable();
    await tester.pumpWidget(_host(submissions));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'Owner');
    await tester.tap(find.byKey(_submit));
    await tester.pumpAndSettle();
    expect(find.text('Not sent'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('outcome-retry')));
    await tester.pumpAndSettle();
    expect(find.text('Owner'), findsOneWidget, reason: 'the answers kept');
  });

  testWidgets('a page for nobody in particular records against nothing', (
    tester,
  ) async {
    final submissions = _FakeSubmissions();
    await tester.pumpWidget(
      _host(
        submissions,
        page: {..._followup, 'subject': 'none', 'title': 'Site check'},
        jobId: null,
      ),
    );
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'Owner');
    await tester.tap(find.byKey(_submit));
    await tester.pumpAndSettle();
    expect(submissions.submitted.single.subject, SubmissionSubject.none);
    expect(submissions.submitted.single.jobId, isNull);
  });
}
