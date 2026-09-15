import 'dart:math' as math;

import 'package:fess_pos/src/core/logging/pos_logger.dart';
import 'package:fess_pos/src/core/theme/pos_tones.dart';
import 'package:fess_pos/src/core/theme/pos_widgets.dart';
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

/// Items that run edge to edge (docs/14 §2, D-97): a list, the stat strip
/// and a divider span the page, and line their content up with the page's
/// side padding themselves.
const Set<String> _edgeToEdge = {'job_list', 'stat_row', 'divider'};

/// Chips next to each other share a line.
const Set<String> _chipTypes = {'status_chip', 'badge'};

/// Draws a `view` definition's items (docs/04 §3.4): each item in order,
/// shown only while its `visible` rule holds. Rules are evaluated by the
/// engine; a rule that fails to evaluate hides its item. [padding]'s sides
/// are the page's side padding.
class ViewRenderer extends StatelessWidget {
  const ViewRenderer({
    required this.items,
    required this.context,
    this.padding = const EdgeInsets.symmetric(
      horizontal: PosTokens.componentPagePaddingX,
      vertical: 16,
    ),
    super.key,
  });

  final List<Object?> items;
  final RenderContext context;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext buildContext) {
    final insets = padding.resolve(Directionality.of(buildContext));
    final ctx = context.withGutter(insets.left);
    final factory = _ItemFactory(ctx);
    Widget inset(Widget w) => insets.left == 0 && insets.right == 0
        ? w
        : Padding(
            padding: EdgeInsets.only(left: insets.left, right: insets.right),
            child: w,
          );
    final children = <Widget>[];
    var chips = <Widget>[];
    void flushChips() {
      if (chips.isEmpty) return;
      children.add(
        inset(
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: Wrap(spacing: 8, runSpacing: 8, children: chips),
          ),
        ),
      );
      chips = <Widget>[];
    }

    for (final item in items.whereType<Map<String, Object?>>()) {
      if (!isVisible(item['visible'], ctx)) continue;
      final type = item['type'];
      if (_chipTypes.contains(type)) {
        if (factory.chip(item) case final Widget chip) chips.add(chip);
        continue;
      }
      flushChips();
      if (factory.build(item) case final Widget w) {
        children.add(_edgeToEdge.contains(type) ? w : inset(w));
      }
    }
    flushChips();
    return Padding(
      padding: EdgeInsets.only(top: insets.top, bottom: insets.bottom),
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
      'status_chip' || 'badge' => _alone(chip(item)),
      'markdown' => _markdown(text(item)),
      'divider' =>
        ctx.inRow
            ? const SizedBox(height: 8)
            : const Divider(height: 32, thickness: 1),
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

  /// A `status_chip` or a `badge`, readable in its tone (docs/14 §3).
  Widget? chip(Map<String, Object?> item) {
    switch (item['type']) {
      case 'status_chip':
        final status = bound(item);
        if (status is! String) return null;
        return PosChip(
          text: ctx.copy('job.status.$status'),
          tone: _statusTone(status),
        );
      case 'badge':
        final value = text(item);
        if (value == null || value.isEmpty) return null;
        return PosChip(text: value, tone: posTone(item['tone']));
    }
    return null;
  }

  Widget? _alone(Widget? chip) => chip == null
      ? null
      : Padding(
          padding: const EdgeInsets.symmetric(vertical: 4),
          child: Align(
            alignment: AlignmentDirectional.centerStart,
            child: chip,
          ),
        );

  Widget? _title(Map<String, Object?> item) {
    final value = text(item) ?? displayValue(bound(item));
    if (value == null) return null;
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Builder(
        builder: (context) => Text(
          value,
          style: ctx.inRow
              ? posRowTitleStyle(context)
              : Theme.of(
                  context,
                ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
        ),
      ),
    );
  }

  /// A labelled value: label over value on a page, one grey line in a row.
  Widget _line(String? label, String value) => ctx.inRow
      ? _RowLine(label: label, value: value)
      : _Labelled(label: label, child: Text(value));

  Widget? _fieldValue(Map<String, Object?> item) {
    final value = displayValue(bound(item));
    if (value == null) return null;
    return _line(label(item), value);
  }

  Widget? _address(Map<String, Object?> item) {
    final lines = addressLines(bound(item));
    if (lines.isEmpty) return null;
    return _line(label(item), lines.join(ctx.inRow ? ', ' : '\n'));
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
    return _line(label(item), shown);
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
            icon: Icon(icon),
            label: Text(ctx.copy('contact.$channel')),
          ),
    ];
    if (buttons.isEmpty) return const [];
    return [
      Padding(
        padding: const EdgeInsets.only(top: 8),
        child: Wrap(spacing: 8, runSpacing: 8, children: buttons),
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
        tone: posTone(item['tone'] ?? 'info'),
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
        ? ('evidence.status.held', PosTone.danger)
        : count('sent') >= total
        ? ('evidence.status.sent', PosTone.success)
        : ('evidence.status.waiting', PosTone.warning);
    return _Labelled(
      label: label(item),
      child: Align(
        alignment: AlignmentDirectional.centerStart,
        child: PosChip(
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
    final cells = [
      for (final t in tiles.whereType<Map<String, Object?>>())
        if (t['type'] == 'stat_tile' && isVisible(t['visible'], ctx))
          _StatTile(item: t, ctx: ctx),
    ];
    if (cells.isEmpty) return null;
    return _StatStrip(cells: cells, gutter: ctx.gutter);
  }

  /// Synced, what waits to go up (envelopes and photos), photos going up
  /// now, or what needs attention (docs/08 §8). With work waiting and no
  /// run going, a Sync now button runs one.
  Widget? _syncStatus() {
    final sync = ctx.data['sync'];
    if (sync is! Map<String, Object?>) return null;
    int count(String key) => switch (sync[key]) {
      final int n => n,
      _ => 0,
    };
    final attention = count('needs_attention');
    final photos = count('photos');
    final waiting = count('pending') + photos;
    final syncing = sync['syncing'] == true;
    final String shown;
    if (attention > 0) {
      shown = ctx.copy('sync.needs_attention');
    } else if (syncing && photos > 0) {
      shown = fillTemplate(ctx.copy('sync.uploading_photos'), {
        'count': photos,
      });
    } else if (waiting > 0) {
      shown = fillTemplate(ctx.copy('sync.pending'), {'count': waiting});
    } else {
      shown = ctx.copy('sync.synced');
    }
    final open = ctx.onNavigate;
    final syncNow = ctx.onSyncNow;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Builder(
        builder: (context) {
          final text = Text(
            shown,
            key: const ValueKey('sync-status'),
            textAlign: TextAlign.center,
            style: attention > 0
                ? Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: PosTokens.colorStatusErrorText,
                  )
                : Theme.of(context).textTheme.bodySmall,
          );
          return Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // What needs attention opens its list (T4-13).
              if (attention > 0 && open != null)
                InkWell(
                  onTap: () =>
                      open(const {'page': 'needs_attention'}, const {}),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    child: text,
                  ),
                )
              else
                text,
              if (waiting > 0 && !syncing && syncNow != null)
                TextButton(
                  key: const ValueKey('sync-now'),
                  onPressed: syncNow,
                  child: Text(ctx.copy('sync.now')),
                ),
            ],
          );
        },
      ),
    );
  }
}

/// A job's status as a tone: done in green, work in hand in the brand's
/// gold, a hold-up in amber, an end in red.
PosTone _statusTone(String status) => switch (status) {
  'approved' || 'closed' || 'submitted' => PosTone.success,
  'returned' || 'paused' || 'appointment_not_secured' => PosTone.warning,
  'rejected' || 'cancelled' || 'unable_to_complete' => PosTone.danger,
  'assigned' || 'accepted' || 'in_progress' || 'under_review' => PosTone.accent,
  _ => PosTone.neutral,
};

IconData _toneIcon(PosTone tone) => switch (tone) {
  PosTone.success => Icons.check_circle_outline,
  PosTone.info => Icons.info_outline,
  PosTone.warning => Icons.warning_amber_outlined,
  PosTone.danger => Icons.error_outline,
  PosTone.accent || PosTone.neutral => Icons.campaign_outlined,
};

class _Banner extends StatelessWidget {
  const _Banner({required this.tone, required this.text, this.title});

  final PosTone tone;
  final String? title;
  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = posToneColors(tone);
    final heading = title;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.background,
        borderRadius: BorderRadius.circular(PosTokens.componentCardInnerRadius),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(_toneIcon(tone), color: colors.foreground, size: 20),
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
                          color: colors.foreground,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  PosMarkdown(
                    text,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: colors.foreground,
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

/// A value under its label, on a page.
class _Labelled extends StatelessWidget {
  const _Labelled({required this.label, required this.child});

  final String? label;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final l = label;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: l == null
          ? child
          : Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(l, style: Theme.of(context).textTheme.bodySmall),
                const SizedBox(height: 2),
                child,
              ],
            ),
    );
  }
}

/// A labelled value in a list row: one grey line, the value in semibold.
class _RowLine extends StatelessWidget {
  const _RowLine({required this.label, required this.value});

  final String? label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final style = posRowDescriptionStyle(context);
    final l = label;
    return Padding(
      padding: const EdgeInsets.only(top: 2),
      child: l == null
          ? Text(value, style: style)
          : Wrap(
              spacing: 6,
              children: [
                Text(l, style: style),
                Text(value, style: style.copyWith(fontWeight: FontWeight.w600)),
              ],
            ),
    );
  }
}

/// The home stats as one flat strip (D-97): cells side by side between
/// hairlines, no cards and no shadows. Up to four in a line, else three.
class _StatStrip extends StatelessWidget {
  const _StatStrip({required this.cells, required this.gutter});

  final List<Widget> cells;
  final double gutter;

  @override
  Widget build(BuildContext context) {
    final perRow = cells.length <= 4 ? cells.length : 3;
    final rows = [
      for (var i = 0; i < cells.length; i += perRow)
        cells.sublist(i, math.min(i + perRow, cells.length)),
    ];
    const line = BorderSide(color: PosTokens.colorLineDivider);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: DecoratedBox(
        decoration: const BoxDecoration(
          border: Border(top: line, bottom: line),
        ),
        child: Padding(
          // A cell's own padding brings its text in line with the page.
          padding: EdgeInsets.symmetric(
            horizontal: math.max(0, gutter - _StatTile.padding),
          ),
          child: Column(
            children: [
              for (var r = 0; r < rows.length; r++) ...[
                if (r > 0) const Divider(height: 1, thickness: 1),
                IntrinsicHeight(
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      for (var c = 0; c < perRow; c++) ...[
                        if (c > 0)
                          const VerticalDivider(width: 1, thickness: 1),
                        Expanded(
                          child: c < rows[r].length
                              ? rows[r][c]
                              : const SizedBox.shrink(),
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _StatTile extends StatelessWidget {
  const _StatTile({required this.item, required this.ctx});

  final Map<String, Object?> item;
  final RenderContext ctx;

  static const double padding = 12;

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
    final open = onTap is Map<String, Object?> && navigate != null
        ? () => navigate(onTap, ctx.data)
        : null;
    final body = Theme.of(context).textTheme.bodyMedium!;
    return InkWell(
      onTap: open,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: padding, vertical: 14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              displayValue(_value) ?? '–',
              style: body.copyWith(
                fontSize: PosTokens.componentStatNumberSize,
                fontWeight: PosTokens.componentStatNumberWeight,
                // Green where it opens something: colour for actions.
                color: open == null
                    ? PosTokens.componentStatNumberColor
                    : Theme.of(context).colorScheme.primary,
              ),
            ),
            if (label is String)
              Padding(
                padding: const EdgeInsets.only(top: 2),
                child: Text(
                  fillTemplate(label, ctx.data),
                  style: body.copyWith(
                    fontSize: PosTokens.componentStatLabelSize,
                    fontWeight: PosTokens.componentStatLabelWeight,
                    color: PosTokens.componentStatLabelColor,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// An embedded, filtered list of the agent's jobs (`job_list`, `11` §7.2),
/// each drawn with its item view (e.g. `job_card`) as one flat row: a
/// store icon, the item view, a chevron and a hairline (D-97).
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
    final groupBy = item['group_by'];
    final gutter = ctx.gutter;
    final theme = Theme.of(context);
    Widget row(Map<String, Object?> job) {
      final data = {...ctx.data, 'job': job};
      return PosListRow(
        key: ValueKey('job-${job['id']}'),
        // Every row is a merchant visit; the icon is the list's look.
        icon: Icons.storefront_outlined,
        gutter: gutter,
        onTap: onTap is Map<String, Object?> && navigate != null
            ? () => navigate(onTap, data)
            : null,
        child: ViewRenderer(
          items: itemView,
          context: ctx.withData(data).asRow(),
          padding: EdgeInsets.zero,
        ),
      );
    }

    Widget heading(String text, TextStyle? style) => Padding(
      padding: EdgeInsets.fromLTRB(gutter, 16, gutter, 8),
      child: Text(text, style: style),
    );
    const hairline = Divider(height: 1, thickness: 1);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (title is String)
          heading(
            fillTemplate(title, ctx.data),
            theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
          ),
        if (jobs.isEmpty && empty is String)
          Padding(
            padding: EdgeInsets.symmetric(horizontal: gutter, vertical: 24),
            child: Text(ctx.copy(empty), textAlign: TextAlign.center),
          ),
        if (groupBy is String)
          for (final (value, members) in _groups(jobs, groupBy)) ...[
            heading(
              _groupLabel(groupBy, value),
              theme.textTheme.titleSmall?.copyWith(
                color: PosTokens.colorTextBody,
              ),
            ),
            hairline,
            for (final job in members) row(job),
          ]
        else ...[
          // FESS's lists open with a hairline above the first row.
          if (jobs.isNotEmpty) hairline,
          for (final job in jobs) row(job),
        ],
      ],
    );
  }

  /// [jobs] grouped by the value at [path], in the order each value first
  /// comes (the list's sort order).
  static List<(Object?, List<Map<String, Object?>>)> _groups(
    List<Map<String, Object?>> jobs,
    String path,
  ) {
    final groups = <Object?, List<Map<String, Object?>>>{};
    for (final job in jobs) {
      (groups[readPath({'job': job}, path)] ??= []).add(job);
    }
    return [for (final e in groups.entries) (e.key, e.value)];
  }

  /// A group's heading: the copy for `<path>.<value>` where there is one
  /// (e.g. `job.status.assigned`), else the value itself.
  String _groupLabel(String path, Object? value) {
    final shown = displayValue(value);
    if (shown == null) return ctx.copy('list.group.none');
    final key = '$path.$shown';
    final copied = ctx.copy(key);
    return copied == key ? shown : copied;
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
