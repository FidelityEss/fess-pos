import 'package:fess_pos/src/core/content/bundled_copy.dart';
import 'package:meta/meta.dart';

/// Everything a view needs to render (docs/04 §3.4, `11` §7.2). The renderer
/// has no database or API access: screens hand it the data.
@immutable
class RenderContext {
  const RenderContext({
    required this.data,
    this.jobs = const [],
    this.itemViews = const {},
    this.copy = BundledCopy.text,
    this.onNavigate,
    this.today,
  });

  /// What items bind to and rules read: `job`, `agent`, `stats`, `sync`.
  final Map<String, Object?> data;

  /// The agent's jobs as pulled, for `job_list` and local `stat_tile`s.
  final List<Map<String, Object?>> jobs;

  /// Item views by key (e.g. `job_card`), each its list of items.
  final Map<String, List<Object?>> itemViews;

  /// Content by key: the server's `core` strings over the bundled ones.
  final String Function(String key) copy;

  /// Opens a tap target such as `{"page": "job_detail"}` for the thing
  /// tapped, e.g. `{"job": {...}}`.
  final void Function(Map<String, Object?> target, Map<String, Object?> data)?
  onNavigate;

  /// Today's date (`YYYY-MM-DD`) for the `today` operator in view rules.
  final String? today;

  /// The same context with other data, e.g. one job of a list.
  RenderContext withData(Map<String, Object?> data) => RenderContext(
    data: data,
    jobs: jobs,
    itemViews: itemViews,
    copy: copy,
    onNavigate: onNavigate,
    today: today,
  );
}
