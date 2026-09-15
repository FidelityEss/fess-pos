import 'package:fess_pos/src/core/content/bundled_copy.dart';
import 'package:flutter/widgets.dart';

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
    this.mapPreview,
    this.openContact,
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

  /// Draws a `map_preview` item for its bound location; the screen supplies
  /// it, since the map needs tiles and the phone's maps app. Without one,
  /// the item is left out.
  final Widget? Function(Map<String, Object?> item, Object? location)?
  mapPreview;

  /// Starts a call, a text message or an email (`call`, `sms`, `email`) to
  /// a `contact` item's number or address; the screen supplies it. Without
  /// one, contacts show without their buttons.
  final void Function(String channel, String address)? openContact;

  /// The same context with other data, e.g. one job of a list.
  RenderContext withData(Map<String, Object?> data) => RenderContext(
    data: data,
    jobs: jobs,
    itemViews: itemViews,
    copy: copy,
    onNavigate: onNavigate,
    today: today,
    mapPreview: mapPreview,
    openContact: openContact,
  );
}
