import 'dart:typed_data';

import 'package:fess_pos/src/contract/errors.dart';
import 'package:fess_pos/src/core/content/bundled_copy.dart';
import 'package:fess_pos/src/core/di/providers.dart';
import 'package:fess_pos/src/features/inspections/capture_page.dart';
import 'package:fess_pos/src/platform/camera.dart';
import 'package:fess_pos/src/platform/location.dart';
import 'package:fess_pos/src/platform/platform_services.dart';
import 'package:fess_pos/src/platform/secure_store.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/fake_platform.dart';

/// A front and a back camera; access can be refused.
class _Camera implements CameraService {
  bool allowed = true;
  int opened = 0;
  int closed = 0;
  String? lastId;

  @override
  Future<List<PosCamera>> cameras() async => const [
    PosCamera(id: 'front', lens: PosLens.front, sensorOrientation: 270),
    PosCamera(id: 'back', lens: PosLens.back, sensorOrientation: 90),
  ];

  @override
  Future<CameraSession> open(
    PosCamera camera, {
    PosCameraResolution resolution = PosCameraResolution.veryHigh,
  }) async {
    if (!allowed) {
      throw const PosException(
        PosErrorCodes.cameraPermissionDenied,
        'not allowed',
        kind: PosErrorKind.platform,
        retryable: false,
      );
    }
    opened++;
    lastId = camera.id;
    return _Session(this);
  }
}

class _Session implements CameraSession {
  _Session(this.camera);

  final _Camera camera;

  @override
  Widget preview() =>
      const ColoredBox(key: ValueKey('preview'), color: Colors.grey);

  @override
  Future<CameraCaptureResult> capture() async =>
      CameraCaptureResult.forTesting(bytes: Uint8List.fromList([1, 2, 3]));

  @override
  Future<void> close() async => camera.closed++;
}

class _Screen {
  _Screen({
    required this.camera,
    required this.store,
    required this.apps,
    required this.location,
  });

  final _Camera camera;
  final MemorySecureStore store;
  final FakeExternalApps apps;
  final FakeLocation location;
  Object? result;
}

LocationFix _fix() => LocationFix(
  latitude: -26.2042,
  longitude: 28.0474,
  accuracyM: 8,
  fixTime: DateTime.utc(2026, 9, 14),
);

Future<_Screen> _show(
  WidgetTester tester, {
  bool explained = false,
  bool allowed = true,
  CapturePage page = const CapturePage(title: 'Shopfront'),
  FakeLocation? location,
}) async {
  final screen = _Screen(
    camera: _Camera()..allowed = allowed,
    store: MemorySecureStore(),
    apps: FakeExternalApps(),
    location: location ?? (FakeLocation()..fix = _fix()),
  );
  if (explained) screen.store.values[cameraExplainedKey] = '1';
  final base = fakePlatform(
    secureStore: screen.store,
    externalApps: screen.apps,
  );
  final services = PlatformServices(
    secureStore: base.secureStore,
    connectivity: base.connectivity,
    location: screen.location,
    camera: screen.camera,
    deviceInfo: base.deviceInfo,
    storage: base.storage,
    integrity: base.integrity,
    backgroundWork: base.backgroundWork,
    externalApps: base.externalApps,
  );
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        platformServicesProvider.overrideWithValue(services),
        activeDefinitionProvider.overrideWith((ref, key) => Stream.value(null)),
      ],
      child: MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () async {
                screen.result = await Navigator.of(context).push<Object?>(
                  MaterialPageRoute<Object?>(
                    builder: (_) => page,
                  ),
                );
              },
              child: const Text('open'),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
  return screen;
}

String _copy(String key) => BundledCopy.text(key);

void _lifecycle(WidgetTester tester, List<AppLifecycleState> states) {
  for (final s in states) {
    tester.binding.handleAppLifecycleStateChanged(s);
  }
}

void main() {
  testWidgets('the first time it says why before the phone asks, then opens '
      'the back camera and returns the photo', (tester) async {
    final s = await _show(tester);
    expect(find.text(_copy('camera.explain.title')), findsOneWidget);
    expect(s.camera.opened, 0, reason: 'nothing asked yet');

    await tester.tap(find.byKey(const ValueKey('camera-explain-continue')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('preview')), findsOneWidget);
    expect(s.camera.lastId, 'back');
    expect(s.store.values[cameraExplainedKey], '1');

    await tester.tap(find.byKey(const ValueKey('capture-shutter')));
    await tester.pumpAndSettle();
    expect(s.result, isA<CameraCaptureResult>());
    expect(s.camera.closed, 1, reason: 'the camera is let go');
  });

  testWidgets('after that, the camera opens straight away', (tester) async {
    final s = await _show(tester, explained: true);
    expect(find.text(_copy('camera.explain.title')), findsNothing);
    expect(find.byKey(const ValueKey('preview')), findsOneWidget);
    expect(s.camera.opened, 1);
  });

  testWidgets('refused: how to turn it on, and it tries again on return', (
    tester,
  ) async {
    final s = await _show(tester, explained: true, allowed: false);
    expect(find.text(_copy('camera.denied')), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('camera-open-settings')));
    await tester.pump();
    expect(s.apps.settingsOpened, 1);
    s.camera.allowed = true;
    _lifecycle(tester, [
      AppLifecycleState.inactive,
      AppLifecycleState.hidden,
      AppLifecycleState.paused,
      AppLifecycleState.hidden,
      AppLifecycleState.inactive,
      AppLifecycleState.resumed,
    ]);
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('preview')), findsOneWidget);
  });

  testWidgets('refused, then allowed: Try again opens it', (tester) async {
    final s = await _show(tester, explained: true, allowed: false);
    s.camera.allowed = true;
    await tester.tap(find.byKey(const ValueKey('camera-try-again')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('preview')), findsOneWidget);
  });

  testWidgets('leaving the app lets the camera go; coming back takes it '
      'again', (tester) async {
    final s = await _show(tester, explained: true);
    _lifecycle(tester, [AppLifecycleState.inactive]);
    await tester.pump();
    expect(s.camera.closed, 0, reason: 'a prompt only makes it inactive');

    _lifecycle(tester, [AppLifecycleState.hidden, AppLifecycleState.paused]);
    await tester.pump();
    // No frames are drawn while the app is hidden; the camera is let go.
    expect(s.camera.closed, 1);

    _lifecycle(tester, [
      AppLifecycleState.hidden,
      AppLifecycleState.inactive,
      AppLifecycleState.resumed,
    ]);
    await tester.pumpAndSettle();
    expect(s.camera.opened, 2);
    expect(find.byKey(const ValueKey('preview')), findsOneWidget);
  });

  testWidgets('the guidance and which photo of a sequence show over the '
      'preview (T4-04)', (tester) async {
    await _show(
      tester,
      explained: true,
      page: const CapturePage(
        title: 'Shopfront',
        guidance: 'Stand across the road.',
        progress: 'Photo 2 of 3',
      ),
    );
    expect(find.text('Stand across the road.'), findsOneWidget);
    expect(find.text('Photo 2 of 3'), findsOneWidget);
  });

  testWidgets('a photo that needs the location waits for a fix', (
    tester,
  ) async {
    final location = FakeLocation();
    final s = await _show(
      tester,
      explained: true,
      location: location,
      page: const CapturePage(title: 'Shopfront', requireLocation: true),
    );
    final shutter = find.byKey(const ValueKey('capture-shutter'));
    expect(find.text(_copy('camera.location_wait')), findsOneWidget);
    expect(
      tester.widget<FloatingActionButton>(shutter).onPressed,
      isNull,
      reason: 'no photo before the phone knows where it is',
    );

    location.fix = _fix();
    await tester.pump(const Duration(seconds: 3));
    await tester.pumpAndSettle();
    expect(find.text(_copy('camera.location_wait')), findsNothing);
    await tester.tap(shutter);
    await tester.pumpAndSettle();
    expect(s.result, isA<CameraCaptureResult>());
  });

  testWidgets('location refused: allow it here, or in settings when the '
      'phone will not ask again', (tester) async {
    final location = FakeLocation()
      ..accessState = LocationAccess.denied
      ..fix = _fix();
    final s = await _show(
      tester,
      explained: true,
      location: location,
      page: const CapturePage(title: 'Shopfront', requireLocation: true),
    );
    final allow = find.byKey(const ValueKey('camera-location-allow'));
    expect(find.text(_copy('camera.location_needed')), findsOneWidget);

    location.accessState = LocationAccess.deniedForever;
    await tester.tap(allow);
    await tester.pumpAndSettle();
    expect(s.apps.settingsOpened, 1);

    location.accessState = LocationAccess.whileInUse;
    _lifecycle(tester, [AppLifecycleState.inactive, AppLifecycleState.resumed]);
    await tester.pumpAndSettle();
    expect(find.text(_copy('camera.location_needed')), findsNothing);
    final shutter = find.byKey(const ValueKey('capture-shutter'));
    expect(tester.widget<FloatingActionButton>(shutter).onPressed, isNotNull);
  });
}
