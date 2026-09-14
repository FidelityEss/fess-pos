import 'package:fess_pos/src/domain/flows/flow_runner.dart';
import 'package:fess_pos_engine/fess_pos_engine.dart';
import 'package:flutter_test/flutter_test.dart';

class _Data implements FlowData {
  _Data({this.answers = const {}, this.hidden = const {}});

  final Map<String, Object?> answers;
  final Set<String> hidden;

  @override
  bool sectionShown(String key) => !hidden.contains(key);

  @override
  Object? evaluate(Object? expr) => evaluateRule(expr, {'answers': answers});
}

/// Shaped like the site-inspection flow fixture (schema/fixtures).
final Map<String, Object?> _flow = {
  'kind': 'flow',
  'family': 'site_inspection_flow',
  'steps': [
    {'id': 'briefing', 'type': 'job_briefing', 'view': 'job_detail'},
    {'id': 'location', 'type': 'location_check'},
    {
      'id': 'profile',
      'type': 'form',
      'sections': ['merchant_profile'],
      'next': {
        'if': [
          {
            '==': [
              {'var': 'answers.trading_years'},
              0,
            ],
          },
          'flow:unable_to_complete_flow',
          'premises',
        ],
      },
    },
    {
      'id': 'skipped',
      'type': 'form',
      'sections': ['skipped'],
    },
    {
      'id': 'premises',
      'type': 'form',
      'sections': ['premises', 'evidence'],
      'paging': 'section_per_page',
    },
    {
      'id': 'review',
      'type': 'summary_review',
      'visible': {'var': 'answers.wants_review'},
    },
    {'id': 'declare', 'type': 'declaration'},
    {'id': 'submit', 'type': 'submit'},
    {'id': 'receipt', 'type': 'receipt', 'view': 'receipt'},
  ],
};

List<String> _positions(Iterable<FlowPosition> ps) => [
  for (final p in ps) '$p',
];

void main() {
  final runner = FlowRunner(_flow);

  test('the location check and the receipt have no page; a form step shown '
      'a section per page has one per section', () {
    expect(_positions(runner.shown(_Data(answers: {'wants_review': true}))), [
      '0.0',
      '2.0',
      '3.0',
      '4.0',
      '4.1',
      '5.0',
      '6.0',
      '7.0',
    ]);
  });

  test(
    'a hidden optional step and a section with nothing shown are skipped',
    () {
      expect(_positions(runner.shown(_Data(hidden: {'evidence'}))), [
        '0.0',
        '2.0',
        '3.0',
        '4.0',
        '6.0',
        '7.0',
      ]);
    },
  );

  test('next goes page by page, then branches as the step says', () {
    final data = _Data(answers: {'trading_years': 3, 'wants_review': true});
    FlowPosition to(FlowPosition from) =>
        (runner.next(from, data) as MoveTo).position;
    expect(to(const FlowPosition(0)), const FlowPosition(2));
    expect(
      to(const FlowPosition(2)),
      const FlowPosition(4),
      reason: '"premises" skips the step in between',
    );
    expect(to(const FlowPosition(4)), const FlowPosition(4, 1));
    expect(to(const FlowPosition(4, 1)), const FlowPosition(5));
    expect(runner.next(const FlowPosition(7), data), isA<MoveEnd>());
  });

  test('a branch to another flow', () {
    final move = runner.next(
      const FlowPosition(2),
      _Data(answers: {'trading_years': 0}),
    );
    expect(move, isA<MoveToFlow>());
    expect((move as MoveToFlow).family, 'unable_to_complete_flow');
  });

  test('pages, unknown targets and targets that come to nothing', () {
    FlowRunner flow(Object? next) => FlowRunner({
      'steps': [
        {
          'id': 'a',
          'type': 'form',
          'sections': ['a'],
          'next': next,
        },
        {
          'id': 'b',
          'type': 'form',
          'sections': ['b'],
        },
      ],
    });
    final data = _Data();
    final page = flow('page:home').next(const FlowPosition(0), data);
    expect((page as MoveToPage).key, 'home');
    for (final next in [
      'nowhere',
      {'var': 'answers.missing'},
      {
        '+': [1, 'x'],
      },
    ]) {
      expect(
        (flow(next).next(const FlowPosition(0), data) as MoveTo).position,
        const FlowPosition(1),
        reason: '$next falls through',
      );
    }
  });

  test('a position round-trips through the draft', () {
    expect(
      FlowPosition.tryParse(const FlowPosition(4, 1).toJson()),
      const FlowPosition(4, 1),
    );
    expect(FlowPosition.tryParse(['4', 1]), isNull);
  });
}
