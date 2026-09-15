import 'package:fess_pos/src/core/di/providers.dart';
import 'package:fess_pos/src/domain/geofence/geofence.dart';
import 'package:fess_pos/src/domain/inspections/inspections.dart';
import 'package:fess_pos/src/domain/jobs/job_record.dart';
import 'package:fess_pos/src/features/inspections/location_check_view.dart';
import 'package:fess_pos/src/features/shell/pos_header.dart';
import 'package:fess_pos_engine/fess_pos_engine.dart' show renderTemplate;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The check-in on arrival (docs/07 §7 item 2, T4-23): a fix recorded
/// outside the premises before the agent goes in, where GPS is often weak
/// indoors. It is kept for the job, and the location check counts it for
/// `geofence.outside_fix.valid_minutes`. Returns true once recorded.
class CheckinPage extends ConsumerStatefulWidget {
  const CheckinPage({
    required this.job,
    required this.plan,
    required this.inspections,
    super.key,
  });

  final JobRecord job;
  final CheckinPlan plan;
  final Inspections inspections;

  @override
  ConsumerState<CheckinPage> createState() => _CheckinPageState();
}

class _CheckinPageState extends ConsumerState<CheckinPage> {
  int _attempt = 0;
  CheckState? _result;
  double? _distance;

  Future<void> _done(LocationCheck check, CheckState state, int sampled) async {
    if (state == CheckState.passed) {
      await widget.inspections.recordCheckin(
        widget.job.id,
        check.passedBy!.fix,
      );
      if (mounted) Navigator.of(context).pop(true);
      return;
    }
    setState(() {
      _result = state;
      _distance = check.closestOutside?.distanceM;
    });
  }

  @override
  Widget build(BuildContext context) {
    final copy = ref.watch(copyProvider);
    final plan = widget.plan;
    final result = _result;
    return Scaffold(
      appBar: PosHeader(
        title: copy('checkin.title'),
        onBack: () => Navigator.of(context).pop(),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(copy('checkin.explain')),
          const SizedBox(height: 16),
          if (result == null)
            FixSampler(
              key: ValueKey(_attempt),
              fence: plan.rule.fenceFor(plan.fence),
              window: plan.window,
              message: copy('checkin.recording'),
              onDone: _done,
            )
          else ...[
            Text(
              switch (result) {
                CheckState.outside => renderTemplate(
                  copy('location.outside'),
                  {'m': _distance?.round()},
                ),
                CheckState.mocked => copy('location.mocked'),
                _ => copy('location.no_lock'),
              },
              key: const ValueKey('checkin-result'),
            ),
            const SizedBox(height: 12),
            OutlinedButton(
              key: const ValueKey('checkin-retry'),
              onPressed: () => setState(() {
                _attempt++;
                _result = null;
              }),
              child: Text(copy('location.try_again')),
            ),
          ],
        ],
      ),
    );
  }
}
