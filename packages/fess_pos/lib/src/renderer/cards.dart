import 'package:fess_pos/src/core/theme/pos_tones.dart';
import 'package:fess_pos/src/core/theme/pos_widgets.dart';
import 'package:fess_pos/src/core/theme/tokens.g.dart';
import 'package:fess_pos/src/renderer/render_context.dart';
import 'package:fess_pos/src/renderer/template.dart';
import 'package:flutter/material.dart';
import 'package:qr/qr.dart';

/// Authorisation cards (B2.6, `11` §7.2, docs/07 §10). What they show comes
/// from the data the screen hands over: `agent` (the server's `me`) and,
/// for the QR, `card` (the agent's) or `job_card` (this job's):
/// `{state: valid | expired | missing, qr, valid_to}`. The QR content is
/// the server's token on the public verify page; nothing comes from the
/// host.
Map<String, Object?> _map(Object? v) =>
    v is Map<String, Object?> ? v : const <String, Object?>{};

String? _name(Map<String, Object?> agent) {
  final name = [
    agent['first_name'],
    agent['last_name'],
  ].map(displayValue).whereType<String>().join(' ');
  return name.isEmpty ? null : name;
}

/// The agent card (`agent_card`) or, with [forJob], the card for this
/// visit (`job_card`): photo, name, employee number, role, status and the
/// QR, each switched by the item's `show_*`. A white box with a light
/// border, no shadow (D-97).
class AuthorisationCard extends StatelessWidget {
  const AuthorisationCard({
    required this.item,
    required this.ctx,
    this.forJob = false,
    super.key,
  });

  final Map<String, Object?> item;
  final RenderContext ctx;
  final bool forJob;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final agent = _map(ctx.data['agent']);
    final card = _map(ctx.data[forJob ? 'job_card' : 'card']);
    final state = card['state'] ?? 'missing';
    final qr = card['qr'];
    final name = _name(agent);
    final number = displayValue(agent['employee_number']);
    final role = displayValue(agent['role']);
    final job = forJob ? _map(ctx.data['job']) : null;
    String month(int m) => ctx.copy('date.month.$m');
    final roleKey = 'card.role.$role';
    final small = theme.textTheme.bodySmall;
    return PosBox(
      key: ValueKey(forJob ? 'job-card' : 'agent-card'),
      margin: const EdgeInsets.symmetric(vertical: 8),
      padding: const EdgeInsets.all(20),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (item['show_photo'] != false) ...[
            AgentAvatar(agent: agent, radius: 40),
            const SizedBox(height: 12),
          ],
          if (name != null)
            Text(
              name,
              textAlign: TextAlign.center,
              style: theme.textTheme.titleLarge,
            ),
          if (number != null)
            Text(
              fillTemplate(ctx.copy('card.employee_number'), {
                'number': number,
              }),
              textAlign: TextAlign.center,
            ),
          if (role != null)
            Text(
              ctx.copy(roleKey) == roleKey ? role : ctx.copy(roleKey),
              textAlign: TextAlign.center,
            ),
          if (item['show_status'] != false) ...[
            const SizedBox(height: 12),
            CardStatus(state: state, ctx: ctx),
          ],
          if (job != null && job.isNotEmpty) ...[
            const SizedBox(height: 16),
            Text(
              ctx.copy('card.job_heading'),
              style: theme.textTheme.titleSmall,
            ),
            for (final line in [
              displayValue(job['reference']),
              displayValue(_map(job['bank'])['name']),
              scheduleText(
                job['scheduled_start'],
                job['scheduled_end'],
                month: month,
              ),
            ].whereType<String>())
              Text(line, textAlign: TextAlign.center),
          ],
          if (item['show_qr'] != false) ...[
            const SizedBox(height: 16),
            if (state == 'valid' && qr is String) ...[
              QrCodeView(data: qr),
              const SizedBox(height: 8),
              Text(
                fillTemplate(ctx.copy('card.valid_until'), {
                  'time': dateTimeText(card['valid_to'], month: month) ?? '',
                }),
                style: small,
              ),
            ] else
              Text(
                ctx.copy(
                  state == 'expired' ? 'card.expired' : 'card.not_ready',
                ),
                textAlign: TextAlign.center,
              ),
          ],
        ],
      ),
    );
  }
}

/// The card on the home page (`agent_card_summary`): who and whether
/// authorised, in a bordered box; tapping opens the full card.
class AgentCardSummary extends StatelessWidget {
  const AgentCardSummary({required this.item, required this.ctx, super.key});

  final Map<String, Object?> item;
  final RenderContext ctx;

  @override
  Widget build(BuildContext context) {
    final agent = _map(ctx.data['agent']);
    final onTap = item['on_tap'];
    final navigate = ctx.onNavigate;
    final open = onTap is Map<String, Object?> && navigate != null
        ? () => navigate(onTap, ctx.data)
        : null;
    return PosBox(
      key: const ValueKey('agent-card-summary'),
      margin: const EdgeInsets.symmetric(vertical: 8),
      padding: const EdgeInsetsDirectional.fromSTEB(16, 16, 8, 16),
      onTap: open,
      child: Row(
        children: [
          AgentAvatar(agent: agent),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  _name(agent) ?? ctx.copy('card.title'),
                  style: posRowTitleStyle(context).copyWith(fontSize: 16),
                ),
                const SizedBox(height: 6),
                CardStatus(
                  state: _map(ctx.data['card'])['state'],
                  ctx: ctx,
                  short: true,
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Icon(
            Icons.qr_code_2,
            size: 28,
            color: Theme.of(context).colorScheme.primary,
          ),
          if (open != null)
            const Icon(
              Icons.chevron_right_rounded,
              size: PosTokens.componentListRowChevronSize,
              color: PosTokens.componentListRowChevron,
            ),
        ],
      ),
    );
  }
}

/// Whether the card authorises the agent now: a readable chip (docs/14 §3).
/// [short] is the home card's wording (`card.status_active_short`), which
/// fits one line on a small phone; the card page keeps the full wording.
class CardStatus extends StatelessWidget {
  const CardStatus({
    required this.state,
    required this.ctx,
    this.short = false,
    super.key,
  });

  final Object? state;
  final RenderContext ctx;
  final bool short;

  @override
  Widget build(BuildContext context) {
    final (text, tone, icon) = switch (state) {
      'valid' => (
        ctx.copy(short ? 'card.status_active_short' : 'card.status_active'),
        PosTone.success,
        Icons.verified_user_outlined,
      ),
      'expired' => (
        ctx.copy('card.status_expired'),
        PosTone.danger,
        Icons.error_outline,
      ),
      _ => (
        ctx.copy('card.status_pending'),
        PosTone.neutral,
        Icons.hourglass_empty,
      ),
    };
    return PosChip(text: text, tone: tone, icon: icon);
  }
}

/// The agent's photo from POS (`agent.photo_url`), else their initials on
/// the brand colour (never blue).
class AgentAvatar extends StatelessWidget {
  const AgentAvatar({required this.agent, this.radius = 24, super.key});

  final Map<String, Object?> agent;
  final double radius;

  @override
  Widget build(BuildContext context) {
    final url = agent['photo_url'];
    final initials = [agent['first_name'], agent['last_name']]
        .map(displayValue)
        .whereType<String>()
        .map((s) => s.characters.first.toUpperCase())
        .join();
    const foreground = PosTokens.componentAvatarForeground;
    return CircleAvatar(
      radius: radius,
      backgroundColor: Theme.of(context).colorScheme.primary,
      foregroundColor: foreground,
      foregroundImage: url is String && url.startsWith('https://')
          ? NetworkImage(url)
          : null,
      onForegroundImageError: url is String ? (_, _) {} : null,
      child: initials.isEmpty
          ? Icon(Icons.person, size: radius, color: foreground)
          : Text(
              initials,
              style: TextStyle(
                fontSize: radius * 0.7,
                fontWeight: FontWeight.w600,
                color: foreground,
              ),
            ),
    );
  }
}

/// A QR code for [data], black on white with a quiet zone, whatever the
/// theme, so any phone camera reads it.
class QrCodeView extends StatelessWidget {
  const QrCodeView({required this.data, this.size = 200, super.key});

  final String data;
  final double size;

  @override
  Widget build(BuildContext context) {
    final image = QrImage(
      QrCode.fromData(data: data, errorCorrectLevel: QrErrorCorrectLevel.M),
    );
    return Semantics(
      container: true,
      image: true,
      label: 'QR code',
      child: ColoredBox(
        color: Colors.white,
        child: Padding(
          padding: EdgeInsets.all(size / 20),
          child: CustomPaint(
            size: Size.square(size),
            painter: _QrPainter(image, data),
          ),
        ),
      ),
    );
  }
}

class _QrPainter extends CustomPainter {
  _QrPainter(this.image, this.data);

  final QrImage image;
  final String data;

  @override
  void paint(Canvas canvas, Size size) {
    final n = image.moduleCount;
    final cell = size.width / n;
    final paint = Paint()
      ..color = Colors.black
      ..isAntiAlias = false;
    for (var row = 0; row < n; row++) {
      for (var col = 0; col < n; col++) {
        if (image.isDark(row, col)) {
          canvas.drawRect(
            Rect.fromLTWH(col * cell, row * cell, cell, cell),
            paint,
          );
        }
      }
    }
  }

  @override
  bool shouldRepaint(_QrPainter oldDelegate) => oldDelegate.data != data;
}
