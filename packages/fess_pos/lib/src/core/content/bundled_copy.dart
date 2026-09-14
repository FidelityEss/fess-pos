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
    'card.title': 'My authorisation card',
    'card.employee_number': 'Employee no. {{number}}',
    'card.role.pos_agent': 'POS agent',
    'card.status_active': 'Authorised Fidelity POS agent — active',
    'card.status_expired': 'Card expired',
    'card.status_pending': 'Card not issued yet',
    'card.valid_until': 'Valid until {{time}}',
    'card.expired':
        'This card has expired. Connect to the internet to refresh it.',
    'card.not_ready':
        'Your card appears after the next sync. Connect to the internet.',
    'card.job_heading': 'Authorised for this visit',
    'map.title': 'Map',
    'map.directions': 'Directions',
    'map.not_configured': "The map isn't set up yet. Directions still work.",
    'map.no_location': 'This job has no map location yet.',
    'map.directions_failed': 'No maps app could open this location.',
    'map.attribution': '© OpenStreetMap contributors',
    'job.action.accept': 'Accept job',
    'job.action.reject': "Can't take this job",
    'job.action.unable': 'Unable to complete',
    'job.action.reject.title': 'Reject job',
    'job.action.unable.title': 'Unable to complete',
    'job.action.submit': 'Submit',
    'job.action.not_allowed':
        'This job has changed on your phone. Go back to see where it stands.',
    'job.action.unavailable':
        "This can't be saved right now. Open POS from FESS again and retry.",
    'job.action.form_missing':
        "This form hasn't reached your phone yet. Connect to the internet "
        'and try again.',
    'outcome.sending': 'Sending…',
    'outcome.success.title': 'Received by the server',
    'outcome.success.message': 'Thank you — the server has confirmed it.',
    'outcome.saved.title': 'Saved on this phone',
    'outcome.saved.message':
        "It will send automatically when you're back online. You don't need "
        'to do anything else.',
    'outcome.failure.title': "This couldn't be completed",
    'outcome.failure.message':
        'Nothing you captured has been lost. Check the message below and try '
        'again, or contact your administrator.',
    'outcome.needs_attention':
        "The server couldn't accept this. Your data is safe and an "
        'administrator has been told.',
    'outcome.home': 'Back to home',
    'outcome.retry': 'Try again',
    'form.error.NOTE_REQUIRED': 'This reason needs a note.',
    'form.error.NOTE_TOO_LONG': 'Use at most 2000 characters.',
    'form.yes': 'Yes',
    'form.no': 'No',
    'form.other': 'Other',
    'form.other_text': 'Describe it',
    'form.select': 'Choose…',
    'form.unsupported_field': 'This question needs a newer version of FESS.',
    'form.unavailable': "This form can't be shown in this version of FESS.",
    'form.error.REQUIRED': 'This answer is required.',
    'form.error.INVALID_TYPE': "This answer isn't in the right format.",
    'form.error.INVALID_ENTRY': "This answer isn't in the right format.",
    'form.error.INVALID_OPTION': 'Choose one of the options shown.',
    'form.error.OTHER_TEXT_REQUIRED': 'Describe the other option.',
    'form.error.TOO_SHORT': 'Enter at least {{min_length}} characters.',
    'form.error.TOO_LONG': 'Use at most {{max_length}} characters.',
    'form.error.PATTERN_MISMATCH': "This doesn't match the expected format.",
    'form.error.DUPLICATE_VALUE': 'The same choice appears twice.',
    'form.error.EXCLUSIVE_OPTION_COMBINED':
        "This choice can't be combined with others.",
    'form.error.multi_select.TOO_FEW': 'Choose at least {{min_select}}.',
    'form.error.multi_select.TOO_MANY': 'Choose at most {{max_select}}.',
    'form.error.photo.TOO_FEW': 'Take at least {{min_count}} photos.',
    'form.error.photo.TOO_MANY': 'Keep at most {{max_count}} photos.',
    'form.error.photo.REQUIRED': 'Take the photos asked for.',
    'form.error.signature.REQUIRED': 'A signature is required.',
    'form.error.declaration.REQUIRED': 'Accept the declaration to continue.',
    'form.error.declaration.NOT_ACCEPTED':
        'Accept the declaration to continue.',
    'inspection.begin': 'Begin inspection',
    'inspection.continue': 'Continue inspection',
    'inspection.definitions_missing':
        "The inspection form hasn't reached your phone yet. Connect to the "
        'internet and try again.',
    'inspection.step': 'Step {{n}} of {{total}}',
    'inspection.next': 'Next',
    'inspection.back': 'Back',
    'inspection.submit': 'Submit inspection',
    'inspection.submit_confirm':
        "Submit this inspection? You can't change it afterwards.",
    'inspection.cancel': 'Cancel',
    'inspection.fix_answers': 'Some answers need attention before you go on.',
    'inspection.ready':
        'Everything is answered. Submit the inspection when you are ready.',
    'inspection.submitted': 'This inspection has been submitted.',
    'inspection.take_photo': 'Take photo',
    'inspection.saving': 'Saving…',
    'inspection.sign': 'Sign',
    'inspection.sign_again': 'Sign again',
    'inspection.signature_title': 'Signature',
    'inspection.signature_hint': 'Sign inside the box.',
    'inspection.clear': 'Clear',
    'inspection.done': 'Done',
    'inspection.declaration_accept': 'I accept this declaration',
    'inspection.declaration_missing':
        "This declaration hasn't reached your phone yet. Connect to the "
        'internet and try again.',
    'inspection.camera_unavailable':
        "The camera couldn't be opened. Check that FESS may use the camera.",
    'inspection.capture_failed': "This couldn't be saved. Try again.",
    'form.error.RULE_ERROR':
        "This question couldn't be checked. Tell your administrator.",
    'form.error.VALIDATION_RULE_FAILED': 'Check this answer.',
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
