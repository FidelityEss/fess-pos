import 'package:fess_pos/src/core/di/providers.dart';
import 'package:fess_pos/src/domain/forms/reason_codes.dart';
import 'package:fess_pos/src/domain/jobs/job_record.dart';
import 'package:fess_pos/src/features/inspections/geofence_override_page.dart';
import 'package:fess_pos/src/renderer/form/form_services.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/fake_platform.dart';

final String _hash = 'a' * 64;

const Map<String, Object?> _form = {
  'spec_version': '1.0',
  'kind': 'form',
  'family': 'geofence_override',
  'version': 1,
  'sections': [
    {
      'key': 'override',
      'fields': [
        {
          'key': 'reason_code',
          'type': 'single_select',
          'display': 'radio',
          'label': 'Reason',
          'required': true,
          'options_source': {
            'type': 'reason_codes',
            'category': 'geofence_override',
          },
        },
        {
          'key': 'note',
          'type': 'textarea',
          'label': 'Explain the difference',
          'required': true,
        },
      ],
    },
  ],
};

final FormFieldServices _services = FormFieldServices(
  takePhoto: (context, field, shot) async => null,
  drawSignature: (context, field) async => null,
  evidenceImage: (id, size) => const SizedBox(),
  declaration: (key) => null,
);

Future<List<Object?>> _show(WidgetTester tester) async {
  final result = <Object?>[];
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        platformServicesProvider.overrideWithValue(fakePlatform()),
        activeDefinitionProvider.overrideWith((ref, key) => Stream.value(null)),
        activeDefinitionVersionProvider.overrideWith(
          (ref, key) => Stream.value(
            key.key == 'geofence_override'
                ? ActiveDefinition(
                    versionId: '0192d4e0-7c1a-7b2e-9f00-0000000000e1',
                    hash: _hash,
                    body: _form,
                  )
                : null,
          ),
        ),
        reasonCodesProvider.overrideWith(
          (ref) => Stream.value(const [
            ReasonCode(
              category: 'geofence_override',
              code: 'gps_inaccurate_indoors',
              label: 'GPS inaccurate indoors',
              requiresNote: true,
            ),
          ]),
        ),
        agentProvider.overrideWith((ref) => Stream.value(const {})),
      ],
      child: MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () async => result.add(
                await Navigator.of(context).push<Map<String, Object?>>(
                  MaterialPageRoute(
                    builder: (_) => GeofenceOverridePage(
                      job: const JobRecord(
                        id: 'j1',
                        reference: 'POS-1',
                        status: 'in_progress',
                        assignedToMe: true,
                        data: {},
                      ),
                      formKey: 'geofence_override',
                      services: _services,
                      distanceM: 120.04,
                      allowedMaxM: 150,
                    ),
                  ),
                ),
              ),
              child: const Text('open'),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
  return result;
}

void main() {
  testWidgets('a reason and a note make the override detail (T4-10)', (
    tester,
  ) async {
    final result = await _show(tester);
    await tester.tap(find.text('GPS inaccurate indoors'));
    await tester.enterText(
      find.byType(TextField),
      'Deep inside the centre, no lock at the unit.',
    );
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('override-submit')));
    await tester.pumpAndSettle();

    final detail = result.single! as Map<String, Object?>;
    expect(detail['reason_code'], 'gps_inaccurate_indoors');
    expect(detail['note'], 'Deep inside the centre, no lock at the unit.');
    expect(
      detail['form_version_id'],
      '0192d4e0-7c1a-7b2e-9f00-0000000000e1',
    );
    expect(detail['answers_hash'], matches(RegExp(r'^[0-9a-f]{64}$')));
    expect(detail['photo_evidence_ids'], isEmpty);
    expect((detail['distance_m'], detail['allowed_max_m']), (120.0, 150.0));
  });

  testWidgets('nothing filled in, it stays', (tester) async {
    final result = await _show(tester);
    await tester.tap(find.byKey(const ValueKey('override-submit')));
    await tester.pumpAndSettle();
    expect(result, isEmpty);
    expect(find.byKey(const ValueKey('override-submit')), findsOneWidget);
  });
}
