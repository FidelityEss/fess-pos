/// Bundled default copy for the module.
///
/// Copy is configuration (docs/04, non-negotiable 3): these are only the
/// offline first-run defaults. The server's content definition (`core`)
/// replaces them key by key as soon as it arrives.
abstract final class BundledCopy {
  static const Map<String, String> en = {
    'shell.title': 'POS verification',
    'shell.back': 'Back',
    'shell.placeholder': 'Your verification jobs will appear here.',
    'shell.unavailable': 'POS verification is not available right now.',
    'shell.not_initialized': 'POS verification is not set up in this app.',
    'shell.not_signed_in': 'Sign in to FESS to see your POS jobs.',
    'jobs.empty_active': 'No active leads. New assignments appear here.',
    'jobs.not_found': 'This job is no longer on this phone.',
    'jobs.loading': 'Loading…',
    'sync.synced': 'Synced',
    'sync.pending': '{{count}} items waiting to upload',
    'sync.needs_attention': 'Needs attention',
    'schedule.unscheduled': 'Not scheduled yet',
    'job.status.pending': 'Pending',
    'job.status.scheduled': 'Scheduled',
    'job.status.assigned': 'Assigned',
    'job.status.accepted': 'Accepted',
    'job.status.in_progress': 'In progress',
    'job.status.paused': 'Paused',
    'job.status.submitted': 'Submitted',
    'job.status.under_review': 'Under review',
    'job.status.returned': 'Returned',
    'job.status.approved': 'Approved',
    'job.status.rejected': 'Rejected',
    'job.status.unable_to_complete': 'Unable to complete',
    'job.status.appointment_not_secured': 'Appointment not secured',
    'job.status.cancelled': 'Cancelled',
    'job.status.closed': 'Closed',
    'date.month.1': 'Jan',
    'date.month.2': 'Feb',
    'date.month.3': 'Mar',
    'date.month.4': 'Apr',
    'date.month.5': 'May',
    'date.month.6': 'Jun',
    'date.month.7': 'Jul',
    'date.month.8': 'Aug',
    'date.month.9': 'Sep',
    'date.month.10': 'Oct',
    'date.month.11': 'Nov',
    'date.month.12': 'Dec',
  };

  /// The copy for [key]; the key itself when it's unknown, so a missing
  /// string is visible rather than blank.
  static String text(String key) => en[key] ?? key;
}
