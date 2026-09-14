/// The engine's share of the C2 budgets, on the synthetic 200-field form
/// with 110 rules (docs/03 §8). C2 sets them for a budget Android phone of
/// 2019; a development machine is about ten times faster, so these tests
/// hold the engine to a tenth of each. The reference device itself is
/// measured in T5-11.
@TestOn('vm')
library;

import 'dart:convert';

import 'package:fess_pos_engine/fess_pos_engine.dart';
import 'package:test/test.dart';

import 'support/synthetic_form.dart';

const double _deviceFactor = 10;

void _report(String what, double ms, double budget) =>
    // A number worth seeing in the PR's perf note.
    // ignore: avoid_print
    print('$what: ${ms.toStringAsFixed(3)} ms (device budget $budget ms)');

void main() {
  test(
    'a 200-field form compiles within its budget (150 ms on the device)',
    () {
      final form = syntheticForm();
      final times = <double>[];
      for (var i = 0; i < 21; i++) {
        final copy = jsonDecode(jsonEncode(form)) as Map<String, Object?>;
        final sw = Stopwatch()..start();
        compileForm(copy);
        times.add(sw.elapsedMicroseconds / 1000);
      }
      times.sort();
      final median = times[times.length ~/ 2];
      _report('compile, median', median, 150);
      expect(median, lessThan(150 / _deviceFactor));
    },
  );

  test('an answer change is re-evaluated within its budget (2 ms on the '
      'device)', () {
    final s = FormSession(
      compileForm(syntheticForm()),
      values: syntheticAnswers(),
    );
    Object? next(int i) => switch (i % 5) {
      0 => i,
      1 => i.isEven,
      2 => ['a', 'b', 'c'][i % 3],
      3 => i.isOdd,
      _ => '2026-01-${(i % 28 + 1).toString().padLeft(2, '0')}',
    };
    const keys = ['s3_f4', 's5_f0', 's7_f7', 's2_f15', 's9_f10'];
    for (var i = 0; i < 500; i++) {
      s.setValue(keys[i % 5], next(i));
    }
    const n = 2000;
    final sw = Stopwatch()..start();
    for (var i = 0; i < n; i++) {
      s.setValue(keys[i % 5], next(i));
    }
    final perChange = sw.elapsedMicroseconds / 1000 / n;
    _report('answer change, mean', perChange, 2);
    expect(perChange, lessThan(2 / _deviceFactor));
  });
}
