import 'package:fess_pos/src/core/content/bundled_copy.dart';
import 'package:fess_pos/src/core/di/providers.dart';
import 'package:fess_pos/src/domain/geofence/geofence.dart';
import 'package:fess_pos/src/domain/inspections/inspections.dart';
import 'package:fess_pos/src/domain/jobs/job_record.dart';
import 'package:fess_pos/src/features/jobs/checkin_page.dart';
import 'package:fess_pos/src/platform/location.dart';
import 'package:fess_pos/src/platform/platform_services.dart';
import 'package:fess_pos_engine/fess_pos_engine.dart' show renderTemplate;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/fake_platform.dart';

/// Only the check-in is recorded here.
class _Inspections implements Inspections {
  final List<(String, GeoFix)> checkins = [];

  @override
  Future<void> recordCheckin(String jobId, GeoFix fix) async =>
      checkins.add((jobId, fix));

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

const double _pinLat = -26.2041;
const double _pinLng = 28.0473;

const CheckinPlan _plan = CheckinPlan(
  fence: Fence(
    profile: 'shopping_centre',
    lat: _pinLat,
    lng: _pinLng,
    radiusM: 250,
    maxAccuracyM: 75,
    exitConsecutiveFixes: 5,
  ),
  rule: OutsideFixRule(
    maxAccuracyM: 30,
    validFor: Duration(minutes: 20),
  ),
  prompt: true,
  window: Duration(seconds: 60),
);

LocationFix _at(double metres) => LocationFix(
  latitude: _pinLat + metres / 111195,
  longitude: _pinLng,
  accuracyM: 10,
  fixTime: DateTime.utc(2026, 9, 14, 10),
  isMocked: false,
);

Future<(List<Object?>, _Inspections, FakeLocation)> _show(
  WidgetTester tester,
) async {
  final result = <Object?>[];
  final inspections = _Inspections();
  final location = FakeLocation();
  final base = fakePlatform();
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        platformServicesProvider.overrideWithValue(
          PlatformServices(
            secureStore: base.secureStore,
            connectivity: base.connectivity,
            location: location,
            camera: base.camera,
            deviceInfo: base.deviceInfo,
            storage: base.storage,
            integrity: base.integrity,
            backgroundWork: base.backgroundWork,
            externalApps: base.externalApps,
          ),
        ),
        activeDefinitionProvider.overrideWith((ref, key) => Stream.value(null)),
      ],
      child: MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () async => result.add(
                await Navigator.of(context).push<bool>(
                  MaterialPageRoute(
                    builder: (_) => CheckinPage(
                      job: const JobRecord(
                        id: 'j1',
                        reference: 'POS-1',
                        status: 'accepted',
                        assignedToMe: true,
                        data: {},
                      ),
                      plan: _plan,
                      inspections: inspections,
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
  // Sampling runs on a clock, so the page never settles while it runs.
  for (var i = 0; i < 5; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
  return (result, inspections, location);
}

void main() {
  testWidgets("an accurate fix at the premises is kept as the job's "
      'check-in', (tester) async {
    final (result, inspections, location) = await _show(tester);
    location.updates.add(_at(20));
    await tester.pumpAndSettle();
    expect(inspections.checkins.single.$1, 'j1');
    expect(result.single, isTrue);
  });

  testWidgets('far from the premises it says how far, and tries again', (
    tester,
  ) async {
    final (result, inspections, location) = await _show(tester);
    location.updates.add(_at(400));
    await tester.pump(const Duration(seconds: 61));
    await tester.pump();
    expect(
      find.text(
        renderTemplate(BundledCopy.text('location.outside'), {'m': 400}),
      ),
      findsOneWidget,
    );
    expect(inspections.checkins, isEmpty);
    await tester.tap(find.byKey(const ValueKey('checkin-retry')));
    await tester.pump();
    expect(find.byKey(const ValueKey('checkin-result')), findsNothing);
  });
}
