import 'package:fess_pos/src/renderer/render_context.dart';
import 'package:fess_pos/src/renderer/view_renderer.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

const List<Object?> _items = [
  {'type': 'title', 'text': 'Joe Spaza'},
  {'type': 'map_preview', 'bind': 'job.location', 'height': 120},
];

const Map<String, Object?> _data = {
  'job': {
    'location': {'lat': 1, 'lng': 2},
  },
};

Future<void> _render(WidgetTester tester, RenderContext ctx) =>
    tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ViewRenderer(items: _items, context: ctx),
        ),
      ),
    );

void main() {
  testWidgets("map_preview is drawn by the screen's builder", (tester) async {
    await _render(
      tester,
      RenderContext(
        data: _data,
        mapPreview: (item, location) =>
            Text('map at $location, ${item['height']} high'),
      ),
    );
    expect(find.text('map at {lat: 1, lng: 2}, 120 high'), findsOneWidget);
  });

  testWidgets('without a builder the item is left out', (tester) async {
    await _render(tester, const RenderContext(data: _data));
    expect(find.text('Joe Spaza'), findsOneWidget);
    expect(find.byType(Text), findsOneWidget);
  });
}
