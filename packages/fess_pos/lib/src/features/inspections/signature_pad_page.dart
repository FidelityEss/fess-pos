import 'dart:ui' as ui;

import 'package:fess_pos/src/core/di/providers.dart';
import 'package:fess_pos/src/domain/inspections/inspections.dart';
import 'package:fess_pos/src/features/shell/pos_header.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The signature pad (`11` §3.5): draw, clear, done. Done renders the
/// strokes to a PNG and returns both as a [SignatureCapture]; the
/// inspection stores it. A minimum stroke length and the signer
/// designation come with T4-05.
class SignaturePadPage extends ConsumerStatefulWidget {
  const SignaturePadPage({required this.title, this.signerName, super.key});

  final String title;

  /// Who is signing, from the field the form binds (`signer_name_field`).
  final String? signerName;

  @override
  ConsumerState<SignaturePadPage> createState() => _SignaturePadPageState();
}

class _SignaturePadPageState extends ConsumerState<SignaturePadPage> {
  /// The render scale: the PNG is twice the pad's size in logical pixels.
  static const double _scale = 2;

  final List<List<Offset>> _strokes = [];
  final List<List<int>> _times = [];
  final Stopwatch _clock = Stopwatch();
  Size _size = Size.zero;
  bool _busy = false;

  bool get _empty => !_strokes.any((s) => s.length > 1);

  void _begin(DragStartDetails d) {
    if (!_clock.isRunning) _clock.start();
    setState(() {
      _strokes.add([d.localPosition]);
      _times.add([_clock.elapsedMilliseconds]);
    });
  }

  void _extend(DragUpdateDetails d) {
    if (_strokes.isEmpty) return;
    setState(() {
      _strokes.last.add(d.localPosition);
      _times.last.add(_clock.elapsedMilliseconds);
    });
  }

  void _clear() => setState(() {
    _strokes.clear();
    _times.clear();
  });

  Future<void> _done() async {
    if (_empty || _size.isEmpty) return;
    setState(() => _busy = true);
    final width = (_size.width * _scale).round();
    final height = (_size.height * _scale).round();
    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder)
      ..scale(_scale)
      ..drawRect(Offset.zero & _size, Paint()..color = Colors.white);
    _paintStrokes(canvas, _strokes);
    final image = await recorder.endRecording().toImage(width, height);
    final data = await image.toByteData(format: ui.ImageByteFormat.png);
    image.dispose();
    if (!mounted) return;
    if (data == null) {
      setState(() => _busy = false);
      return;
    }
    double round(double v) => (v * 10).roundToDouble() / 10;
    Navigator.of(context).pop(
      SignatureCapture(
        strokes: [
          for (var i = 0; i < _strokes.length; i++)
            [
              for (var j = 0; j < _strokes[i].length; j++)
                [
                  round(_strokes[i][j].dx),
                  round(_strokes[i][j].dy),
                  _times[i][j],
                ],
            ],
        ],
        png: data.buffer.asUint8List(),
        width: width,
        height: height,
        capturedAt: DateTime.now(),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final copy = ref.watch(copyProvider);
    final theme = Theme.of(context);
    final signer = widget.signerName;
    return Scaffold(
      appBar: PosHeader(
        title: widget.title,
        onBack: () => Navigator.of(context).pop(),
      ),
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (signer != null && signer.trim().isNotEmpty)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
                child: Text(signer, style: theme.textTheme.titleMedium),
              ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
              child: Text(copy('inspection.signature_hint')),
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    border: Border.all(color: theme.colorScheme.outline),
                  ),
                  child: LayoutBuilder(
                    builder: (context, box) {
                      _size = box.biggest;
                      return GestureDetector(
                        key: const ValueKey('signature-pad'),
                        onPanStart: _begin,
                        onPanUpdate: _extend,
                        child: CustomPaint(
                          foregroundPainter: _StrokesPainter(_strokes),
                          child: const ColoredBox(
                            color: Colors.white,
                            child: SizedBox.expand(),
                          ),
                        ),
                      );
                    },
                  ),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
              child: Row(
                children: [
                  OutlinedButton(
                    key: const ValueKey('signature-clear'),
                    onPressed: _empty || _busy ? null : _clear,
                    child: Text(copy('inspection.clear')),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: FilledButton(
                      key: const ValueKey('signature-done'),
                      onPressed: _empty || _busy ? null : _done,
                      child: Text(copy('inspection.done')),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

void _paintStrokes(Canvas canvas, List<List<Offset>> strokes) {
  final paint = Paint()
    ..color = Colors.black
    ..strokeWidth = 3
    ..strokeCap = StrokeCap.round
    ..strokeJoin = StrokeJoin.round
    ..style = PaintingStyle.stroke;
  for (final stroke in strokes) {
    if (stroke.length == 1) {
      canvas.drawCircle(stroke.single, 1.5, paint..style = PaintingStyle.fill);
      paint.style = PaintingStyle.stroke;
      continue;
    }
    final path = Path()..moveTo(stroke.first.dx, stroke.first.dy);
    for (final p in stroke.skip(1)) {
      path.lineTo(p.dx, p.dy);
    }
    canvas.drawPath(path, paint);
  }
}

class _StrokesPainter extends CustomPainter {
  _StrokesPainter(this.strokes);

  final List<List<Offset>> strokes;

  @override
  void paint(Canvas canvas, Size size) => _paintStrokes(canvas, strokes);

  // The strokes grow in place as the agent draws.
  @override
  bool shouldRepaint(_StrokesPainter oldDelegate) => true;
}
