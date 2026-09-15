import 'package:fess_pos/src/core/di/providers.dart';
import 'package:fess_pos/src/domain/inspections/inspections.dart';
import 'package:fess_pos/src/domain/jobs/job_record.dart';
import 'package:fess_pos/src/features/jobs/job_pages.dart';
import 'package:fess_pos/src/platform/external_apps.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/fake_platform.dart';

JobRecord _job(String id, String merchant, {String? bankId}) => JobRecord(
  id: id,
  reference: 'POS-$id',
  status: 'assigned',
  assignedToMe: true,
  bankId: bankId,
  data: {
    'id': id,
    'reference': 'POS-$id',
    'status': 'assigned',
    'merchant_name': merchant,
    'address': const {'line1': '1 Main Rd', 'city': 'Durban'},
  },
);

/// The server's views, as the seed publishes them (trimmed).
const Map<String, Object?> _home = {
  'items': [
    {'type': 'greeting', 'text': 'Hi {{agent.first_name}}'},
    {
      'type': 'job_list',
      'item_view': 'job_card',
      'on_tap': {'page': 'job_detail'},
      'empty_content': 'jobs.empty_active',
    },
  ],
};

const Map<String, Object?> _jobCard = {
  'items': [
    {'type': 'title', 'bind': 'job.merchant_name'},
  ],
};

const Map<String, Object?> _jobDetail = {
  'items': [
    {'type': 'field_value', 'label': 'Reference', 'bind': 'job.reference'},
    {'type': 'address_block', 'label': 'Address', 'bind': 'job.address'},
  ],
};

Widget _app(
  Widget child, {
  List<JobRecord> jobs = const [],
  bool withViews = true,
  Map<String, String> content = const {},
}) => ProviderScope(
  overrides: [
    myJobsProvider.overrideWith((ref) => Stream.value(jobs)),
    jobProvider.overrideWith(
      (ref, id) => Stream.value(
        jobs.where((j) => j.id == id).firstOrNull,
      ),
    ),
    agentProvider.overrideWith(
      (ref) => Stream.value({'first_name': 'Sipho'}),
    ),
    agentTotalsProvider.overrideWith((ref) => Stream.value(null)),
    activeDefinitionProvider.overrideWith(
      (ref, key) => Stream.value(switch ((key.kind, key.key)) {
        ('view', 'home') when withViews => _home,
        ('view', 'job_card') when withViews => _jobCard,
        ('view', 'job_detail') when withViews => _jobDetail,
        ('content', 'core') => {'strings': content},
        _ => null,
      }),
    ),
  ],
  child: MaterialApp(home: child),
);

void main() {
  testWidgets('the home view lists the agent’s jobs; one opens', (
    tester,
  ) async {
    final opened = <String>[];
    await tester.pumpWidget(
      _app(
        JobsHomePage(onOpenJob: opened.add),
        jobs: [_job('j1', 'Joe Spaza'), _job('j2', 'Mama’s Kitchen')],
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Hi Sipho'), findsOneWidget);
    expect(find.text('Joe Spaza'), findsOneWidget);
    expect(find.text('Mama’s Kitchen'), findsOneWidget);
    await tester.tap(find.text('Mama’s Kitchen'));
    expect(opened, ['j2']);
  });

  testWidgets('no jobs: the server’s empty text', (tester) async {
    await tester.pumpWidget(
      _app(
        JobsHomePage(onOpenJob: (_) {}),
        content: {'jobs.empty_active': 'Nothing assigned yet.'},
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Nothing assigned yet.'), findsOneWidget);
  });

  testWidgets('before any view arrives the bundled ones list jobs', (
    tester,
  ) async {
    await tester.pumpWidget(
      _app(
        JobsHomePage(onOpenJob: (_) {}),
        jobs: [_job('j1', 'Joe Spaza')],
        withViews: false,
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Joe Spaza'), findsOneWidget);
    expect(find.text('POS-j1'), findsOneWidget);
  });

  testWidgets('the detail page shows the job_detail view', (tester) async {
    var closed = false;
    await tester.pumpWidget(
      _app(
        JobDetailPage(jobId: 'j1', onBack: () => closed = true),
        jobs: [_job('j1', 'Joe Spaza')],
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Joe Spaza'), findsOneWidget, reason: 'the header');
    expect(find.text('POS-j1'), findsOneWidget);
    expect(find.text('1 Main Rd\nDurban'), findsOneWidget);
    await tester.tap(find.byTooltip('Back'));
    expect(closed, isTrue);
  });

  testWidgets("a job's page uses its bank's wording over the default, shows "
      'how its evidence is getting on, and calls its contact (T3-05)', (
    tester,
  ) async {
    final apps = FakeExternalApps()..opens = false;
    final job = _job('j1', 'Joe Spaza', bankId: 'bank-a');
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          platformServicesProvider.overrideWithValue(
            fakePlatform(externalApps: apps),
          ),
          jobProvider.overrideWith((ref, id) => Stream.value(job)),
          agentProvider.overrideWith((ref) => Stream.value(null)),
          latestInspectionProvider.overrideWith(
            (ref, jobId) => Stream.value(
              const InspectionRecord(
                id: 'i1',
                jobId: 'j1',
                attempt: 1,
                status: 'submitted',
                formVersionId: 'f1',
                flowVersionId: 'fl1',
                contextSnapshot: {},
                values: {},
                otherText: {},
                currentStep: 0,
                startedAtDevice: '2026-09-15T08:00:00+02:00',
              ),
            ),
          ),
          inspectionEvidenceProvider.overrideWith(
            (ref, id) => Stream.value(const [
              EvidenceItem(
                id: 'e1',
                fieldKey: 'p',
                type: 'photo',
                state: 'verified',
              ),
              EvidenceItem(
                id: 'e2',
                fieldKey: 'p',
                type: 'photo',
                state: 'local_only',
              ),
            ]),
          ),
          activeDefinitionProvider.overrideWith(
            (ref, key) => Stream.value(switch ((key.kind, key.key)) {
              ('view', 'job_detail') => const {
                'items': [
                  {'type': 'status_chip', 'bind': 'job.status'},
                  {'type': 'evidence_status', 'bind': 'inspection.evidence'},
                  {'type': 'contact', 'bind': 'job.contact'},
                ],
              },
              ('content', 'core') when key.bankId == 'bank-a' => const {
                'strings': {'job.status.assigned': 'Allocated'},
              },
              ('content', 'core') => const {
                'strings': {
                  'job.status.assigned': 'Assigned (default)',
                  'contact.call': 'Phone them',
                },
              },
              _ => null,
            }),
          ),
        ],
        child: MaterialApp(
          home: JobDetailPage(jobId: 'j1', onBack: () {}),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Allocated'), findsOneWidget, reason: "the bank's own");
    expect(
      find.text('1 of 2 uploaded; the rest will send automatically'),
      findsOneWidget,
    );
    expect(find.text('Phone them'), findsNothing, reason: 'no contact yet');
  });

  testWidgets('a contact on the job page opens the phone app, and says so '
      'when none can (T3-05)', (tester) async {
    final apps = FakeExternalApps()..opens = false;
    const job = JobRecord(
      id: 'j1',
      reference: 'POS-j1',
      status: 'assigned',
      assignedToMe: true,
      data: {
        'id': 'j1',
        'merchant_name': 'Joe Spaza',
        'contact': {'name': 'Joe', 'phone': '082 000 1111'},
      },
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          platformServicesProvider.overrideWithValue(
            fakePlatform(externalApps: apps),
          ),
          jobProvider.overrideWith((ref, id) => Stream.value(job)),
          agentProvider.overrideWith((ref) => Stream.value(null)),
          activeDefinitionProvider.overrideWith(
            (ref, key) => Stream.value(switch ((key.kind, key.key)) {
              ('view', 'job_detail') => const {
                'items': [
                  {'type': 'contact', 'bind': 'job.contact'},
                ],
              },
              _ => null,
            }),
          ),
        ],
        child: MaterialApp(
          home: JobDetailPage(jobId: 'j1', onBack: () {}),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('contact-sms')));
    await tester.pumpAndSettle();
    expect(apps.contacts, [(ContactChannel.sms, '082 000 1111')]);
    expect(find.text('No app on this phone can open that.'), findsOneWidget);
  });

  testWidgets('a job gone from the phone says so', (tester) async {
    await tester.pumpWidget(
      _app(JobDetailPage(jobId: 'gone', onBack: () {})),
    );
    await tester.pumpAndSettle();
    expect(find.text('This job is no longer on this phone.'), findsOneWidget);
  });
}
