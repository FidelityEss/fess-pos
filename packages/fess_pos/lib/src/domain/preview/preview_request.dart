import 'package:meta/meta.dart';

/// What a preview draws (docs/04 §10, T3-08): one definition, perhaps a
/// draft, with the definitions it refers to and a sample context. It
/// mirrors the props of the admin's `DefinitionPreview`.
@immutable
class PreviewRequest {
  const PreviewRequest({
    required this.kind,
    required this.definition,
    this.bundle = const {},
    this.context = const {},
    this.theme = const {},
  });

  /// The request in [json] as the studio or the preview route sends it:
  /// `{kind, definition, bundle, context, theme?}`; null when it isn't one.
  static PreviewRequest? fromJson(Object? json) {
    if (json is! Map<String, Object?>) return null;
    final kind = json['kind'];
    final definition = json['definition'];
    if (kind is! String || !kinds.contains(kind)) return null;
    if (definition is! Map<String, Object?>) return null;
    final bundle = json['bundle'];
    final context = json['context'];
    final theme = json['theme'];
    return PreviewRequest(
      kind: kind,
      definition: definition,
      bundle: bundle is Map<String, Object?> ? bundle : const {},
      context: context is Map<String, Object?> ? context : const {},
      theme: theme is Map<String, Object?> ? theme : const {},
    );
  }

  static const Set<String> kinds = {
    'form',
    'flow',
    'view',
    'content',
    'job_schema',
    'app',
  };

  final String kind;
  final Map<String, Object?> definition;

  /// The definitions it refers to: `forms`, `flows` and `views` by key,
  /// the merged content `strings`, `declarations` and `lists`.
  final Map<String, Object?> bundle;

  /// The sample `today`, `job`, `agent`, `inspection` and `stats`.
  final Map<String, Object?> context;

  /// The look being tried, as remote config's `theme.*` would set it
  /// (D-45): `primary_color` (`#RRGGBB`) and `font_family`. Empty: the
  /// brand's own.
  final Map<String, Object?> theme;

  /// The previewed definition's family key, e.g. `home`.
  String? get family {
    final f = definition['family'];
    return f is String ? f : null;
  }

  /// The key the previewed definition is found by: its family, or `draft`
  /// for a draft that doesn't name one yet.
  String get familyKey => family ?? 'draft';

  /// The definition [versionId] names ([previewVersionId]); null for any
  /// other id.
  Map<String, Object?>? definitionOfVersion(String versionId) {
    final parts = versionId.split(':');
    if (parts.length != 3 || parts.first != 'preview') return null;
    return definitionOf(parts[1], parts[2]);
  }

  /// The definition of [kind] and [key] a preview draws with: the one
  /// previewed, else the bundle's. The `core` content is the bundle's
  /// strings with a previewed content definition's over them.
  Map<String, Object?>? definitionOf(String kind, String key) {
    if (kind == 'content' && key == 'core') {
      final base = bundle['strings'];
      final own = this.kind == 'content' ? definition['strings'] : null;
      return {
        'strings': {
          if (base is Map<String, Object?>) ...base,
          if (own is Map<String, Object?>) ...own,
        },
      };
    }
    if (kind == this.kind && key == familyKey) return definition;
    final group = bundle['${kind}s'];
    final found = group is Map<String, Object?> ? group[key] : null;
    return found is Map<String, Object?> ? found : null;
  }
}

/// The version id a preview names definition [key] of [kind] by, where an
/// inspection would pin a real version: `preview:<kind>:<key>`.
String previewVersionId(String kind, String key) => 'preview:$kind:$key';

/// Drafts to preview on a phone, by the short-lived token a "Preview on
/// phone" link carries (docs/04 §10).
// An interface, not a typedef: sources are swapped as objects.
// ignore: one_member_abstracts
abstract interface class PreviewDrafts {
  /// The request for [token]; null when it's unknown or has expired.
  Future<PreviewRequest?> fetch(String token);
}
