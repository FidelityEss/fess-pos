import 'package:fess_pos/src/renderer/markdown.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

String _plain(List<InlineSpan> spans) =>
    TextSpan(children: spans).toPlainText();

TextStyle? _styleOf(List<InlineSpan> spans, String text) =>
    spans.whereType<TextSpan>().firstWhere((s) => s.text == text).style;

void main() {
  test('blocks: headings, lists and paragraphs', () {
    final blocks = markdownBlocks('''
# Before you go
Bring the merchant's ID
and the bank letter.

- Photos of the shop front
* The till point
2. Sign the declaration
### Last
''');
    expect(blocks.map((b) => b.kind), [
      MarkdownBlockKind.heading,
      MarkdownBlockKind.paragraph,
      MarkdownBlockKind.bullet,
      MarkdownBlockKind.bullet,
      MarkdownBlockKind.numbered,
      MarkdownBlockKind.heading,
    ]);
    expect(blocks[0].level, 1);
    expect(blocks[1].text, "Bring the merchant's ID and the bank letter.");
    expect(blocks[4].marker, '2.');
    expect(blocks[4].text, 'Sign the declaration');
    expect(blocks[5].level, 3);
  });

  test('inline: bold, italic, code; links show their text only', () {
    final spans = markdownSpans(
      'Take **three** photos, *clearly*, of _each_ till: `POS-1`. '
      'See [the guide](https://example.com/guide).',
    );
    expect(
      _plain(spans),
      'Take three photos, clearly, of each till: POS-1. See the guide.',
    );
    expect(_styleOf(spans, 'three')?.fontWeight, FontWeight.w600);
    expect(_styleOf(spans, 'clearly')?.fontStyle, FontStyle.italic);
    expect(_styleOf(spans, 'each')?.fontStyle, FontStyle.italic);
    expect(_styleOf(spans, 'POS-1')?.fontFamily, 'monospace');
    expect(_plain(spans), isNot(contains('example.com')));
  });

  test('underscores inside words and lone stars stay as written', () {
    expect(_plain(markdownSpans('the job_card view')), 'the job_card view');
    expect(_plain(markdownSpans('2 * 3 * 4')), '2 * 3 * 4');
    expect(markdownSpans('plain').single, isA<TextSpan>());
  });

  testWidgets('draws each block', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(body: PosMarkdown('## Checklist\n- **Till** point')),
      ),
    );
    expect(find.text('Checklist'), findsOneWidget);
    expect(find.text('•'), findsOneWidget);
    expect(find.text('Till point'), findsOneWidget);
  });
}
