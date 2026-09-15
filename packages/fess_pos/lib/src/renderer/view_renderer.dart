import 'package:fess_pos/src/core/logging/pos_logger.dart';
import 'package:fess_pos/src/core/theme/tokens.g.dart';
import 'package:fess_pos/src/renderer/cards.dart';
import 'package:fess_pos/src/renderer/icons.dart';
import 'package:fess_pos/src/renderer/markdown.dart';
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
      'markdown' => _markdown(text(item)),
      'divider' => const Divider(height: 24),
      'contact' => _contact(item),
      'greeting' => _heading(text(item), large: true),
      'section_title' => _heading(text(item)),
      'stat_row' => _statRow(item),
      'stat_tile' => _StatTile(item: item, ctx: ctx),
      'job_list' => JobList(item: item, ctx: ctx),
      'sync_status' => _syncStatus(),
      'announcement' => _announcement(item),
      'action_button' => _actionButton(item),
      'evidence_status' => _evidenceStatus(item),
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

  Widget? _markdown(String? value) {
    if (value == null || value.trim().isEmpty) return null;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: PosMarkdown(value),
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
    final phone = displayValue(contact['phone']);
    final email = displayValue(contact['email']);
    final lines = [
      displayValue(contact['name']),
      displayValue(contact['role']),
      phone,
      email,
    ].whereType<String>().toList();
    if (lines.isEmpty) return null;
    return _Labelled(
      label: label(item),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(lines.join('\n')),
          ..._contactButtons(item['actions'], phone: phone, email: email),
        ],
      ),
    );
  }

  /// Call, text or email the contact in the phone's own apps (`actions`,
  /// all of them by default), where the screen can open them.
  List<Widget> _contactButtons(
    Object? actions, {
    required String? phone,
    required String? email,
  }) {
    final open = ctx.openContact;
    if (open == null) return const [];
    bool offered(String channel) =>
        actions is! List<Object?> || actions.contains(channel);
    final buttons = [
      for (final (channel, address, icon) in [
        ('call', phone, Icons.phone_outlined),
        ('sms', phone, Icons.sms_outlined),
        ('email', email, Icons.email_outlined),
      ])
        if (address != null && offered(channel))
          OutlinedButton.icon(
            key: ValueKey('contact-$channel'),
            onPressed: () => open(channel, address),
            icon: Icon(icon, size: 18),
            label: Text(ctx.copy('contact.$channel')),
          ),
    ];
    if (buttons.isEmpty) return const [];
    return [
      Padding(
        padding: const EdgeInsets.only(top: 4),
        child: Wrap(spacing: 8, runSpacing: 4, children: buttons),
      ),
    ];
  }

  /// A button that opens a page or a flow (`on_tap`), e.g. a form page.
  Widget? _actionButton(Map<String, Object?> item) {
    final shown = label(item) ?? text(item);
    final target = item['on_tap'];
    if (shown == null || shown.trim().isEmpty) return null;
    if (target is! Map<String, Object?>) return null;
    final open = ctx.onNavigate;
    final onPressed = open == null ? null : () => open(target, ctx.data);
    final key = ValueKey('action-button-${item['key'] ?? shown}');
    final icon = posIcon(item['icon']);
    final secondary = item['style'] == 'secondary';
    final child = Text(shown);
    final Widget button;
    if (icon == null) {
      button = secondary
          ? OutlinedButton(key: key, onPressed: onPressed, child: child)
          : FilledButton(key: key, onPressed: onPressed, child: child);
    } else {
      button = secondary
          ? OutlinedButton.icon(
              key: key,
              onPressed: onPressed,
              icon: Icon(icon),
              label: child,
            )
          : FilledButton.icon(
              key: key,
              onPressed: onPressed,
              icon: Icon(icon),
              label: child,
            );
    }
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: button,
    );
  }

  /// An administrator's banner (`announcement`): a tone, an optional
  /// title and Markdown text.
  Widget? _announcement(Map<String, Object?> item) {
    final body = text(item);
    if (body == null || body.trim().isEmpty) return null;
    final title = item['title'];
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: _Banner(
        tone: _tone(item['tone'] ?? 'info'),
        title: title is String ? fillTemplate(title, ctx.data) : null,
        text: body,
      ),
    );
  }

  /// How an inspection's evidence is getting on (`evidence_status`, the
  /// receipt's upload state), bound to its counts: `total`, `sent`,
  /// `waiting` and `held`.
  Widget? _evidenceStatus(Map<String, Object?> item) {
    final counts = bound(item);
    if (counts is! Map<String, Object?>) return null;
    int count(String key) => switch (counts[key]) {
      final int n => n,
      _ => 0,
    };
    final total = count('total');
    if (total == 0) return null;
    final (key, tone) = count('held') > 0
        ? ('evidence.status.held', _Tone.danger)
        : count('sent') >= total
        ? ('evidence.status.sent', _Tone.success)
        : ('evidence.status.waiting', _Tone.warning);
    return _Labelled(
      label: label(item),
      child: Align(
        alignment: AlignmentDirectional.centerStart,
        child: _Chip(
          key: const ValueKey('evidence-status'),
          text: fillTemplate(ctx.copy(key), counts),
          tone: tone,
        ),
      ),
    );
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

(Color, Color) _toneColors(ColorScheme scheme, _Tone tone) => switch (tone) {
  _Tone.success => (scheme.primaryContainer, scheme.onPrimaryContainer),
  _Tone.info => (scheme.secondaryContainer, scheme.onSecondaryContainer),
  _Tone.warning => (scheme.tertiaryContainer, scheme.onTertiaryContainer),
  _Tone.danger => (scheme.errorContainer, scheme.onErrorContainer),
  _Tone.neutral => (scheme.surfaceContainerHighest, scheme.onSurfaceVariant),
};

IconData _toneIcon(_Tone tone) => switch (tone) {
  _Tone.success => Icons.check_circle_outline,
  _Tone.info => Icons.info_outline,
  _Tone.warning => Icons.warning_amber_outlined,
  _Tone.danger => Icons.error_outline,
  _Tone.neutral => Icons.campaign_outlined,
};

class _Banner extends StatelessWidget {
  const _Banner({required this.tone, required this.text, this.title});

  final _Tone tone;
  final String? title;
  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final (background, foreground) = _toneColors(theme.colorScheme, tone);
    final heading = title;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(PosTokens.radiusCard),
      ),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(_toneIcon(tone), color: foreground, size: 20),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (heading != null && heading.trim().isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 4),
                      child: Text(
                        heading,
                        style: theme.textTheme.titleSmall?.copyWith(
                          color: foreground,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  PosMarkdown(
                    text,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: foreground,
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

class _Chip extends StatelessWidget {
  const _Chip({required this.text, required this.tone, super.key});

  final String text;
  final _Tone tone;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final (background, foreground) = _toneColors(scheme, tone);
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
