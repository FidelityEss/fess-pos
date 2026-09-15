import 'package:flutter/material.dart';

/// The Markdown a definition's text may use (`markdown` view items and
/// `info` fields, `11` §4 and §7.2): paragraphs, `#` to `###` headings,
/// `-`, `*` or `1.` lists, `**bold**`, `*italic*` or `_italic_`, and
/// `` `code` ``. A link shows its text only: the module opens no address
/// a definition gives. Anything else shows as written.
class PosMarkdown extends StatelessWidget {
  const PosMarkdown(this.source, {this.style, super.key});

  final String source;

  /// The body style; the theme's `bodyMedium` when null.
  final TextStyle? style;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context).textTheme;
    final base = style ?? theme.bodyMedium;
    final blocks = markdownBlocks(source);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        for (final (i, block) in blocks.indexed)
          Padding(
            padding: EdgeInsets.only(
              top: i == 0 ? 0 : _gapBefore(block, blocks[i - 1]),
            ),
            child: _block(block, theme, base),
          ),
      ],
    );
  }

  static double _gapBefore(MarkdownBlock block, MarkdownBlock previous) {
    if (block.kind == MarkdownBlockKind.heading) return 12;
    final inList =
        block.kind != MarkdownBlockKind.paragraph &&
        previous.kind != MarkdownBlockKind.paragraph &&
        previous.kind != MarkdownBlockKind.heading;
    return inList ? 2 : 8;
  }

  static Widget _block(MarkdownBlock block, TextTheme theme, TextStyle? base) {
    Widget rich(TextStyle? style) => Text.rich(
      TextSpan(style: style, children: markdownSpans(block.text)),
    );
    return switch (block.kind) {
      MarkdownBlockKind.heading => rich(
        (block.level == 1 ? theme.titleMedium : theme.titleSmall)?.copyWith(
          fontWeight: FontWeight.w600,
        ),
      ),
      MarkdownBlockKind.bullet || MarkdownBlockKind.numbered => Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 24,
            child: Text(block.marker ?? '•', style: base),
          ),
          Expanded(child: rich(base)),
        ],
      ),
      MarkdownBlockKind.paragraph => rich(base),
    };
  }
}

enum MarkdownBlockKind { paragraph, heading, bullet, numbered }

/// One block of a Markdown text.
@immutable
class MarkdownBlock {
  const MarkdownBlock(this.kind, this.text, {this.level = 0, this.marker});

  final MarkdownBlockKind kind;

  /// The block's text, its inline Markdown still in it.
  final String text;

  /// A heading's level, 1 to 3.
  final int level;

  /// A numbered item's number as shown, e.g. `2.`; null otherwise.
  final String? marker;
}

final RegExp _heading = RegExp(r'^(#{1,3})\s+(.*)$');
final RegExp _bullet = RegExp(r'^[-*+]\s+(.*)$');
final RegExp _numbered = RegExp(r'^(\d{1,3})[.)]\s+(.*)$');

/// The blocks of [source]: lines next to each other make one paragraph; a
/// blank line, a heading or a list item ends it.
List<MarkdownBlock> markdownBlocks(String source) {
  final blocks = <MarkdownBlock>[];
  final paragraph = <String>[];
  void flush() {
    if (paragraph.isEmpty) return;
    blocks.add(
      MarkdownBlock(MarkdownBlockKind.paragraph, paragraph.join(' ')),
    );
    paragraph.clear();
  }

  for (final raw in source.split('\n')) {
    final line = raw.trim();
    if (line.isEmpty) {
      flush();
      continue;
    }
    final heading = _heading.firstMatch(line);
    final bullet = _bullet.firstMatch(line);
    final numbered = _numbered.firstMatch(line);
    if (heading != null) {
      flush();
      blocks.add(
        MarkdownBlock(
          MarkdownBlockKind.heading,
          heading[2]!.trim(),
          level: heading[1]!.length,
        ),
      );
    } else if (bullet != null) {
      flush();
      blocks.add(MarkdownBlock(MarkdownBlockKind.bullet, bullet[1]!.trim()));
    } else if (numbered != null) {
      flush();
      blocks.add(
        MarkdownBlock(
          MarkdownBlockKind.numbered,
          numbered[2]!.trim(),
          marker: '${numbered[1]}.',
        ),
      );
    } else {
      paragraph.add(line);
    }
  }
  flush();
  return blocks;
}

final RegExp _inline = RegExp(
  // 1: **bold**
  r'\*\*(.+?)\*\*'
  // 2: *italic*, not part of ** and not around spaces
  r'|(?<![\w*])\*(?![\s*])(.+?)(?<!\s)\*(?![\w*])'
  // 3: _italic_, not inside a word such as job_card
  r'|(?<!\w)_(?!\s)(.+?)(?<!\s)_(?!\w)'
  // 4: `code`
  '|`([^`]+)`'
  // 5, 6: [text](address)
  r'|\[([^\]]+)\]\(([^)\s]+)\)',
);

const TextStyle _bold = TextStyle(fontWeight: FontWeight.w600);
const TextStyle _italic = TextStyle(fontStyle: FontStyle.italic);
const TextStyle _code = TextStyle(fontFamily: 'monospace');

/// The spans of one block's [text], its inline Markdown applied.
List<InlineSpan> markdownSpans(String text) {
  final spans = <InlineSpan>[];
  var at = 0;
  for (final m in _inline.allMatches(text)) {
    if (m.start > at) spans.add(TextSpan(text: text.substring(at, m.start)));
    if (m[1] != null) {
      spans.add(TextSpan(text: m[1], style: _bold));
    } else if (m[2] != null || m[3] != null) {
      spans.add(TextSpan(text: m[2] ?? m[3], style: _italic));
    } else if (m[4] != null) {
      spans.add(TextSpan(text: m[4], style: _code));
    } else {
      spans.add(TextSpan(text: m[5]));
    }
    at = m.end;
  }
  if (at < text.length) spans.add(TextSpan(text: text.substring(at)));
  return spans;
}
