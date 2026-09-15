import 'package:fess_pos/src/core/logging/pos_logger.dart';
import 'package:fess_pos/src/core/theme/tokens.g.dart';
import 'package:fess_pos/src/renderer/cards.dart';
import 'package:fess_pos/src/renderer/render_context.dart';
import 'package:fess_pos/src/renderer/template.dart';
import 'package:fess_pos_engine/fess_pos_engine.dart';
import 'package:flutter/material.dart';

export 'package:fess_pos/src/contract/capabilities.dart'
    show supportedViewComponents;

const PosLogger _log = PosLogger('renderer');

/// Draws a `view` definition's items (docs/04 §3.4): each item in order,
/// shown only while its `visible` rule holds. Rules are evaluated by the
/// engine; a rule that fails to evaluate hides its item.
class ViewRenderer extends StatelessWidget {
  const ViewRenderer({
    required this.items,
    required this.context,
    this.padding = const EdgeInsets.all(16),
    super.key,
  });

  final List<Object?> items;
  final RenderContext context;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext buildContext) {
    final children = renderItems(items, context);
    return Padding(
      padding: padding,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: children,
      ),
    );
  }
}

/// The widgets for [items], skipping hidden and unsupported ones.
List<Widget> renderItems(List<Object?> items, RenderContext ctx) => [
  for (final item in items.whereType<Map<String, Object?>>())
    if (isVisible(item['visible'], ctx)) ?_ItemFactory(ctx).build(item),
];

/// Whether a `visible` rule holds for [ctx]'s data. No rule: shown.
bool isVisible(Object? rule, RenderContext ctx) {
  if (rule == null) return true;
  try {
    return evaluateRuleBoolean(
      rule,
      ctx.data,
      env: RuleEnv(today: ctx.today),
    );
  } on RuleError catch (e) {
    _log.warning('a view rule failed (${e.code}); its item is hidden');
    return false;
  }
}

class _ItemFactory {
  const _ItemFactory(this.ctx);

  final RenderContext ctx;

  Object? bound(Map<String, Object?> item) {
    final bind = item['bind'];
    return bind is String ? readPath(ctx.data, bind) : null;
  }

  String? text(Map<String, Object?> item) {
    final t = item['text'];
    return t is String ? fillTemplate(t, ctx.data) : null;
  }

  String? label(Map<String, Object?> item) {
    final l = item['label'];
    return l is String ? fillTemplate(l, ctx.data) : null;
  }

  Widget? build(Map<String, Object?> item) {
    final type = item['type'];
    return switch (type) {
      'title' => _title(item),
      'field_value' => _fieldValue(item),
      'address_block' => _address(item),
      'schedule_window' => _schedule(item),
      'status_chip' => _statusChip(item),
      'badge' => _badge(item),
      'markdown' => _paragraph(text(item)),
      'divider' => const Divider(height: 24),
      'contact' => _contact(item),
      'greeting' => _heading(text(item), large: true),
      'section_title' => _heading(text(item)),
      'stat_row' => _statRow(item),
      'stat_tile' => _StatTile(item: item, ctx: ctx),
      'job_list' => JobList(item: item, ctx: ctx),
      'sync_status' => _syncStatus(),
      'announcement' => _badge(item),
      'map_preview' => ctx.mapPreview?.call(item, bound(item)),
      'agent_card' => AuthorisationCard(item: item, ctx: ctx),
      'job_card' => AuthorisationCard(item: item, ctx: ctx, forJob: true),
      'agent_card_summary' => AgentCardSummary(item: item, ctx: ctx),
      _ => _unsupported(type),
    };
  }

  Widget? _unsupported(Object? type) {
    _log.debug('view component $type is not in this build; left out');
    return null;
  }

  Widget? _title(Map<String, Object?> item) {
    final value = text(item) ?? displayValue(bound(item));
    if (value == null) return null;
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Builder(
        builder: (context) => Text(
          value,
          style: Theme.of(
            context,
          ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
        ),
      ),
    );
  }

  Widget? _fieldValue(Map<String, Object?> item) {
    final value = displayValue(bound(item));
    if (value == null) return null;
    return _Labelled(label: label(item), child: Text(value));
  }

  Widget? _address(Map<String, Object?> item) {
    final lines = addressLines(bound(item));
    if (lines.isEmpty) return null;
    return _Labelled(label: label(item), child: Text(lines.join('\n')));
  }

  Widget? _schedule(Map<String, Object?> item) {
    final value = bound(item);
    final window = value is Map<String, Object?>
        ? value
        : const <String, Object?>{};
    final shown =
        scheduleText(
          window['start'],
          window['end'],
          month: (m) => ctx.copy('date.month.$m'),
        ) ??
        ctx.copy('schedule.unscheduled');
    return _Labelled(label: label(item), child: Text(shown));
  }

  Widget? _statusChip(Map<String, Object?> item) {
    final status = bound(item);
    if (status is! String) return null;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Align(
        alignment: AlignmentDirectional.centerStart,
        child: _Chip(
          text: ctx.copy('job.status.$status'),
          tone: _statusTone(status),
        ),
      ),
    );
  }

  Widget? _badge(Map<String, Object?> item) {
    final value = text(item);
    if (value == null || value.isEmpty) return null;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: _Chip(text: value, tone: _tone(item['tone'])),
    );
  }

  Widget? _paragraph(String? value) {
    if (value == null || value.trim().isEmpty) return null;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Text(value),
    );
  }

  Widget? _heading(String? value, {bool large = false}) {
    if (value == null || value.trim().isEmpty) return null;
    return Padding(
      padding: EdgeInsets.only(top: large ? 0 : 16, bottom: 8),
      child: Builder(
        builder: (context) {
          final theme = Theme.of(context).textTheme;
          return Text(
            value,
            style: (large ? theme.titleLarge : theme.titleMedium)?.copyWith(
              fontWeight: FontWeight.w600,
            ),
          );
        },
      ),
    );
  }

  Widget? _contact(Map<String, Object?> item) {
    final contact = bound(item);
    if (contact is! Map<String, Object?>) return null;
    final lines = [
      displayValue(contact['name']),
      displayValue(contact['role']),
      displayValue(contact['phone']),
      displayValue(contact['email']),
    ].whereType<String>().toList();
    if (lines.isEmpty) return null;
    return _Labelled(label: label(item), child: Text(lines.join('\n')));
  }

  Widget? _statRow(Map<String, Object?> item) {
    final tiles = item['tiles'];
    if (tiles is! List<Object?>) return null;
    final children = renderItems(tiles, ctx);
    if (children.isEmpty) return null;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Wrap(spacing: 8, runSpacing: 8, children: children),
    );
  }

  Widget? _syncStatus() {
    final sync = ctx.data['sync'];
    if (sync is! Map<String, Object?>) return null;
    final attention = sync['needs_attention'];
    final pending = sync['pending'];
    final String shown;
    if (attention is int && attention > 0) {
      shown = ctx.copy('sync.needs_attention');
    } else if (pending is int && pending > 0) {
      shown = fillTemplate(ctx.copy('sync.pending'), {'count': pending});
    } else {
      shown = ctx.copy('sync.synced');
    }
    final text = Text(
      shown,
      key: const ValueKey('sync-status'),
      textAlign: TextAlign.center,
    );
    final open = ctx.onNavigate;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      // What needs attention opens its list (T4-13).
      child: attention is int && attention > 0 && open != null
          ? InkWell(
              onTap: () => open(const {'page': 'needs_attention'}, const {}),
              child: text,
            )
          : text,
    );
  }
}

enum _Tone { neutral, info, success, warning, danger }

_Tone _tone(Object? tone) => switch (tone) {
  'info' => _Tone.info,
  'success' => _Tone.success,
  'warning' => _Tone.warning,
  'danger' || 'error' => _Tone.danger,
  _ => _Tone.neutral,
};

_Tone _statusTone(String status) => switch (status) {
  'approved' || 'closed' || 'submitted' => _Tone.success,
  'returned' || 'paused' || 'appointment_not_secured' => _Tone.warning,
  'rejected' || 'cancelled' || 'unable_to_complete' => _Tone.danger,
  'assigned' || 'accepted' || 'in_progress' || 'under_review' => _Tone.info,
  _ => _Tone.neutral,
};

class _Chip extends StatelessWidget {
  const _Chip({required this.text, required this.tone});

  final String text;
  final _Tone tone;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final (background, foreground) = switch (tone) {
      _Tone.success => (scheme.primaryContainer, scheme.onPrimaryContainer),
      _Tone.info => (scheme.secondaryContainer, scheme.onSecondaryContainer),
      _Tone.warning => (scheme.tertiaryContainer, scheme.onTertiaryContainer),
      _Tone.danger => (scheme.errorContainer, scheme.onErrorContainer),
      _Tone.neutral => (
        scheme.surfaceContainerHighest,
        scheme.onSurfaceVariant,
      ),
    };
    return DecoratedBox(
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(PosTokens.radiusControl),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        child: Text(
          text,
          style: Theme.of(
            context,
          ).textTheme.labelMedium?.copyWith(color: foreground),
        ),
      ),
    );
  }
}

class _Labelled extends StatelessWidget {
  const _Labelled({required this.label, required this.child});

  final String? label;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final l = label;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: l == null
          ? child
          : Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  l,
                  style: Theme.of(context).textTheme.labelMedium?.copyWith(
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: 2),
                child,
              ],
            ),
    );
  }
}

class _StatTile extends StatelessWidget {
  const _StatTile({required this.item, required this.ctx});

  final Map<String, Object?> item;
  final RenderContext ctx;

  Object? get _value {
    if (item['source'] == 'server') {
      final stat = item['stat'];
      return stat is String ? readPath(ctx.data, stat) : null;
    }
    // A count of local records matching the tile's rule.
    if (item['collection'] != null && item['collection'] != 'jobs') return null;
    final filter = item['filter'];
    return ctx.jobs
        .where(
          (job) => isVisible(filter, ctx.withData({...ctx.data, 'job': job})),
        )
        .length;
  }

  @override
  Widget build(BuildContext context) {
    final label = item['label'];
    final onTap = item['on_tap'];
    final navigate = ctx.onNavigate;
    final tile = Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(PosTokens.radiusCard),
        onTap: onTap is Map<String, Object?> && navigate != null
            ? () => navigate(onTap, ctx.data)
            : null,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                displayValue(_value) ?? '–',
                style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                  fontWeight: FontWeight.w600,
                ),
              ),
              if (label is String) Text(fillTemplate(label, ctx.data)),
            ],
          ),
        ),
      ),
    );
    return SizedBox(width: 150, child: tile);
  }
}

/// An embedded, filtered list of the agent's jobs (`job_list`, `11` §7.2),
/// each drawn with its item view (e.g. `job_card`).
class JobList extends StatelessWidget {
  const JobList({required this.item, required this.ctx, super.key});

  final Map<String, Object?> item;
  final RenderContext ctx;

  List<Map<String, Object?>> get _jobs {
    final filter = item['filter'];
    final jobs = [
      for (final job in ctx.jobs)
        if (isVisible(filter, ctx.withData({...ctx.data, 'job': job}))) job,
    ];
    final sort = item['sort'];
    if (sort is String) {
      final descending = item['sort_direction'] == 'desc';
      jobs.sort((a, b) {
        final order = _compareValues(
          readPath({'job': a}, sort),
          readPath({'job': b}, sort),
        );
        return descending ? -order : order;
      });
    }
    final limit = item['limit'];
    return limit is int && jobs.length > limit ? jobs.sublist(0, limit) : jobs;
  }

  @override
  Widget build(BuildContext context) {
    final jobs = _jobs;
    final title = item['title'];
    final empty = item['empty_content'];
    final itemView = ctx.itemViews[item['item_view']] ?? const [];
    final onTap = item['on_tap'];
    final navigate = ctx.onNavigate;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (title is String)
          Padding(
            padding: const EdgeInsets.only(top: 8, bottom: 4),
            child: Text(
              fillTemplate(title, ctx.data),
              style: Theme.of(context).textTheme.titleMedium,
            ),
          ),
        if (jobs.isEmpty && empty is String)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 24),
            child: Text(ctx.copy(empty), textAlign: TextAlign.center),
          ),
        for (final job in jobs)
          Card(
            key: ValueKey('job-${job['id']}'),
            margin: const EdgeInsets.symmetric(vertical: 6),
            child: InkWell(
              borderRadius: BorderRadius.circular(PosTokens.radiusCard),
              onTap: onTap is Map<String, Object?> && navigate != null
                  ? () => navigate(onTap, {...ctx.data, 'job': job})
                  : null,
              child: ViewRenderer(
                items: itemView,
                context: ctx.withData({...ctx.data, 'job': job}),
                padding: const EdgeInsets.all(12),
              ),
            ),
          ),
      ],
    );
  }
}

/// Sort order: numbers by value, text by code unit, missing values last.
int _compareValues(Object? a, Object? b) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (a is num && b is num) return a.compareTo(b);
  return '$a'.compareTo('$b');
}
