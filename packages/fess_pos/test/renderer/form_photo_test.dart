import 'package:fess_pos/src/renderer/form/form_controller.dart';
import 'package:fess_pos/src/renderer/form/form_services.dart';
import 'package:fess_pos/src/renderer/form/form_view.dart';
import 'package:fess_pos_engine/fess_pos_engine.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// A camera that hands out evidence ids in turn, or nothing once the agent
/// goes back ([backAfter] photos).
class _Camera {
  _Camera({this.backAfter});

  final int? backAfter;
  final List<PhotoShot> shots = [];
  final Map<String, String> captions = {};

  FormFieldServices get services => FormFieldServices(
    takePhoto: (context, field, shot) async {
      if (backAfter case final int n when shots.length >= n) return null;
      shots.add(shot);
      return 'e${shots.length}';
    },
    drawSignature: (context, field) async => null,
    evidenceImage: (id, size) =>
        SizedBox.square(key: ValueKey('image-$id'), dimension: size),
    evidenceCaption: (id) => captions[id],
    declaration: (key) => null,
  );
}

Future<FormController> _show(
  WidgetTester tester,
  _Camera camera,
  Map<String, Object?> field, {
  Map<String, Object?> initialValues = const {},
}) async {
  final controller = FormController(
    definition: {
      'sections': [
        {
          'key': 's',
          'fields': [field],
        },
      ],
    },
    context: const ResolveContext(job: {'reference': 'POS-7'}),
    initialValues: initialValues,
  );
  addTearDown(controller.dispose);
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: SingleChildScrollView(
          child: FormView(controller: controller, services: camera.services),
        ),
      ),
    ),
  );
  return controller;
}

Map<String, Object?> _photos(
  Map<String, Object?> props, {
  String? display,
}) => {
  'key': 'outside',
  'type': 'photo',
  'label': 'Outside',
  'display': ?display,
  'props': {'category': 'external', ...props},
};

final Finder _take = find.byKey(const ValueKey('photo-take-outside'));

Finder _thumb(int i) => find.byKey(ValueKey('photo-thumb-outside-$i'));

void main() {
  testWidgets('the guidance, how many are needed, and no more than the most', (
    tester,
  ) async {
    final camera = _Camera();
    final c = await _show(
      tester,
      camera,
      _photos({
        'min_count': 1,
        'max_count': 2,
        'guidance': {'text': 'Stand across the road for {{job.reference}}.'},
      }),
    );
    expect(find.text('Stand across the road for POS-7.'), findsOneWidget);
    expect(find.text('0 taken · 1 to 2'), findsOneWidget);

    await tester.tap(_take);
    await tester.pumpAndSettle();
    await tester.tap(_take);
    await tester.pumpAndSettle();
    expect(c.value('outside'), ['e1', 'e2']);
    expect(find.text('2 taken · 1 to 2'), findsOneWidget);
    expect(tester.widget<OutlinedButton>(_take).onPressed, isNull);
    expect(camera.shots.map((s) => (s.number, s.of)), [(1, null), (2, null)]);
  });

  testWidgets('a guided sequence takes photo after photo up to the least '
      'needed, and stops when the agent goes back', (tester) async {
    final camera = _Camera();
    final c = await _show(
      tester,
      camera,
      _photos({'min_count': 3, 'max_count': 5}, display: 'guided_sequence'),
    );
    await tester.tap(_take);
    await tester.pumpAndSettle();
    expect(camera.shots.map((s) => (s.number, s.of)), [
      (1, 3),
      (2, 3),
      (3, 3),
    ]);
    expect(c.value('outside'), ['e1', 'e2', 'e3']);

    // With the least taken, a tap is one more photo.
    await tester.tap(_take);
    await tester.pumpAndSettle();
    expect(camera.shots.last.number, 4);
    expect(camera.shots.last.of, 4);

    final back = _Camera(backAfter: 1);
    final d = await _show(
      tester,
      back,
      _photos({'min_count': 3}, display: 'guided_sequence'),
    );
    await tester.tap(_take);
    await tester.pumpAndSettle();
    expect(d.value('outside'), ['e1'], reason: 'what was taken is kept');
  });

  testWidgets('a photo can be retaken or removed, and shows its caption', (
    tester,
  ) async {
    final camera = _Camera()..captions['e1'] = 'The front door';
    final c = await _show(tester, camera, _photos({}));
    await tester.tap(_take);
    await tester.pumpAndSettle();
    expect(find.text('The front door'), findsOneWidget);

    await tester.tap(_thumb(0));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('photo-retake-outside-0')));
    await tester.pumpAndSettle();
    expect(c.value('outside'), ['e2'], reason: 'replaced in place');
    expect(camera.shots.last.number, 1);

    await tester.tap(_thumb(0));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('photo-remove-outside-0')));
    await tester.pumpAndSettle();
    expect(c.value('outside'), isEmpty);
  });

  testWidgets('retake: confirm asks first; disallowed offers nothing', (
    tester,
  ) async {
    final camera = _Camera();
    final c = await _show(tester, camera, _photos({'retake': 'confirm'}));
    await tester.tap(_take);
    await tester.pumpAndSettle();
    await tester.tap(_thumb(0));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('photo-remove-outside-0')));
    await tester.pumpAndSettle();
    expect(c.value('outside'), ['e1'], reason: 'not before the agent agrees');
    await tester.tap(find.byKey(const ValueKey('photo-confirm-outside')));
    await tester.pumpAndSettle();
    expect(c.value('outside'), isEmpty);

    final locked = await _show(
      tester,
      _Camera(),
      _photos({'retake': 'disallowed'}),
    );
    await tester.tap(_take);
    await tester.pumpAndSettle();
    await tester.tap(_thumb(0));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('photo-remove-outside-0')), findsNothing);
    expect(locked.value('outside'), ['e1']);
  });
}
