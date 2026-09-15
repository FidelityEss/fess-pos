/// The flow runner (docs/04 §3.2, `11` §6): which step and page of a flow
/// come next. Steps run in order unless a step's `next` branches, to
/// another step, another flow (`flow:<family>`) or an app page
/// (`page:<key>`), or to whichever of those an expression yields. Optional
/// steps show while their `visible` rule holds. A form step shown a
/// section per page has a page per section, and a section with nothing
/// shown is skipped.
///
/// Pure: what it reads comes through [FlowData].
library;

import 'package:fess_pos_engine/fess_pos_engine.dart' show RuleError;
import 'package:meta/meta.dart';

/// The step types a flow may have (`11` §6).
const Set<String> flowStepTypes = {
  'job_briefing',
  'location_check',
  'form',
  'summary_review',
  'declaration',
  'submit',
  'receipt',
};

/// Steps without a page of their own: the receipt is the outcome page shown
/// once the flow is submitted.
const Set<String> _passThrough = {'receipt'};

/// Where the agent is in a flow: a step, and its page.
@immutable
class FlowPosition {
  const FlowPosition(this.step, [this.page = 0]);

  /// From `[step, page]`; null when malformed.
  static FlowPosition? tryParse(Object? json) => switch (json) {
    [final int step, final int page] => FlowPosition(step, page),
    _ => null,
  };

  final int step;
  final int page;

  List<int> toJson() => [step, page];

  @override
  bool operator ==(Object other) =>
      other is FlowPosition && other.step == step && other.page == page;

  @override
  int get hashCode => Object.hash(step, page);

  @override
  String toString() => '$step.$page';
}

/// What a flow reads while it runs.
abstract interface class FlowData {
  /// Whether the form's section [key] has anything to show now.
  bool sectionShown(String key);

  /// [expr] evaluated against the answers and the context; throws
  /// [RuleError].
  Object? evaluate(Object? expr);

  /// Whether the location check has passed (T4-07): its step has a page
  /// until it has.
  bool get locationChecked;
}

/// Where Next leads.
sealed class FlowMove {
  const FlowMove();
}

/// To another page of this flow.
final class MoveTo extends FlowMove {
  const MoveTo(this.position);

  final FlowPosition position;
}

/// To another flow, by family (`flow:<family>`).
final class MoveToFlow extends FlowMove {
  const MoveToFlow(this.family);

  final String family;
}

/// To an app page, by key (`page:<key>`).
final class MoveToPage extends FlowMove {
  const MoveToPage(this.key);

  final String key;
}

/// Nowhere: nothing is shown after this page.
final class MoveEnd extends FlowMove {
  const MoveEnd();
}

class FlowRunner {
  FlowRunner(Map<String, Object?> flow)
    : steps = [
        if (flow['steps'] case final List<Object?> list)
          for (final s in list)
            if (s is Map<String, Object?>) s,
      ];

  final List<Map<String, Object?>> steps;

  String? typeOf(int step) {
    final t = steps[step]['type'];
    return t is String ? t : null;
  }

  /// The form sections of step [step], in order.
  List<String> sections(int step) => [
    if (steps[step]['sections'] case final List<Object?> list)
      for (final s in list)
        if (s is String) s,
  ];

  bool _perSection(int step) =>
      typeOf(step) == 'form' && steps[step]['paging'] == 'section_per_page';

  int pageCount(int step) => _perSection(step) ? sections(step).length : 1;

  /// The sections [at] shows: its own with a page per section, otherwise
  /// all of its step's.
  List<String> sectionsAt(FlowPosition at) =>
      _perSection(at.step) ? [sections(at.step)[at.page]] : sections(at.step);

  /// Whether [at] is shown now.
  bool shows(FlowPosition at, FlowData data) {
    if (at.step < 0 ||
        at.step >= steps.length ||
        at.page < 0 ||
        at.page >= pageCount(at.step)) {
      return false;
    }
    final type = typeOf(at.step);
    if (type == null ||
        !flowStepTypes.contains(type) ||
        _passThrough.contains(type)) {
      return false;
    }
    // An integrity step: shown until the location has passed, whatever its
    // `visible` says.
    if (type == 'location_check') return !data.locationChecked;
    final visible = steps[at.step]['visible'];
    if (visible != null && !_holds(visible, data)) return false;
    if (type == 'form') return sectionsAt(at).any(data.sectionShown);
    return true;
  }

  /// The first position shown at or after [from], in document order.
  FlowPosition? firstFrom(FlowPosition from, FlowData data) {
    for (var s = from.step; s < steps.length; s++) {
      for (var p = s == from.step ? from.page : 0; p < pageCount(s); p++) {
        final at = FlowPosition(s, p);
        if (shows(at, data)) return at;
      }
    }
    return null;
  }

  /// Every position shown now, in document order.
  List<FlowPosition> shown(FlowData data) => [
    for (var s = 0; s < steps.length; s++)
      for (var p = 0; p < pageCount(s); p++)
        if (shows(FlowPosition(s, p), data)) FlowPosition(s, p),
  ];

  /// Where Next leads from [at]: the step's next page shown; otherwise its
  /// `next`; otherwise the next step shown.
  FlowMove next(FlowPosition at, FlowData data) {
    for (var p = at.page + 1; p < pageCount(at.step); p++) {
      final to = FlowPosition(at.step, p);
      if (shows(to, data)) return MoveTo(to);
    }
    var from = at.step + 1;
    final target = _target(steps[at.step]['next'], data);
    if (target != null) {
      if (target.startsWith('flow:')) return MoveToFlow(target.substring(5));
      if (target.startsWith('page:')) return MoveToPage(target.substring(5));
      final i = steps.indexWhere((s) => s['id'] == target);
      // An id the flow doesn't have falls through, as no `next` does.
      if (i >= 0) from = i;
    }
    final to = firstFrom(FlowPosition(from), data);
    return to == null ? const MoveEnd() : MoveTo(to);
  }

  /// A `visible` rule: a rule that fails shows the step, as for fields.
  static bool _holds(Object? rule, FlowData data) {
    if (rule is bool) return rule;
    try {
      return data.evaluate(rule) == true;
    } on RuleError {
      return true;
    }
  }

  /// A `next`: a target, or an expression yielding one; null (or a rule
  /// that fails) falls through to the following step.
  static String? _target(Object? next, FlowData data) {
    if (next == null || next is String) return next as String?;
    try {
      final v = data.evaluate(next);
      return v is String ? v : null;
    } on RuleError {
      return null;
    }
  }
}
