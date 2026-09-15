// `SentryEvent.extra` is deprecated but still sent, so it is still scrubbed.
// ignore_for_file: deprecated_member_use

import 'package:sentry/sentry.dart';

/// Keys whose values may identify a person or carry a secret, location or
/// evidence (docs/DEVELOPMENT-GUIDELINES.md §4). Matching is deliberately
/// broad: losing a harmless value is cheaper than leaking a personal one.
final RegExp _sensitiveKey = RegExp(
  'token|secret|password|passwd|authori[sz]ation|cookie|session|email|phone|'
  'mobile|msisdn|name|address|lat|lng|lon|coord|location|geo|gps|hash|'
  'signature|employee|id_number|ip',
  caseSensitive: false,
);

const String _scrubbed = '[scrubbed]';

/// `beforeSend` for the module's hub: keeps only the opaque user id, drops
/// the request, and scrubs sensitive keys in extras, tags and breadcrumbs.
SentryEvent? scrubEvent(SentryEvent event, Hint hint) {
  final id = event.user?.id;
  event
    ..user = id == null ? null : SentryUser(id: id)
    ..request = null
    ..extra = _scrubMap(event.extra)
    ..tags = _scrubStrings(event.tags)
    ..breadcrumbs = event.breadcrumbs?.map(_scrubBreadcrumbData).toList();
  return event;
}

/// `beforeBreadcrumb` for the module's hub.
Breadcrumb? scrubBreadcrumb(Breadcrumb? breadcrumb, Hint hint) =>
    breadcrumb == null ? null : _scrubBreadcrumbData(breadcrumb);

Breadcrumb _scrubBreadcrumbData(Breadcrumb b) => b..data = _scrubMap(b.data);

Map<String, dynamic>? _scrubMap(Map<String, dynamic>? map) {
  if (map == null) return null;
  return {
    for (final e in map.entries)
      e.key: _sensitiveKey.hasMatch(e.key) ? _scrubbed : _scrubValue(e.value),
  };
}

Object? _scrubValue(Object? v) => switch (v) {
  final Map<String, dynamic> m => _scrubMap(m),
  final List<Object?> l => l.map(_scrubValue).toList(),
  _ => v,
};

Map<String, String>? _scrubStrings(Map<String, String>? map) {
  if (map == null) return null;
  return {
    for (final e in map.entries)
      e.key: _sensitiveKey.hasMatch(e.key) ? _scrubbed : e.value,
  };
}
