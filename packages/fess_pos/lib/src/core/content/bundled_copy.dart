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
    'page.unavailable': "This page isn't available in this version of the app.",
    'page.agent_card.title': 'My authorisation card',
    'page.active_jobs.title': 'Active leads',
    'page.receipt.title': 'Receipt',
    'storage.sync_required':
        "There isn't room on this phone for a new inspection. Connect to "
        'sync so finished work can leave the phone, or free up space.',
    'storage.capture_full':
        "The phone's storage is full. Free up space to take photos; your "
        'answers are kept.',
    'preview.label': 'Preview',
    'preview.waiting': 'Waiting for something to preview…',
    'preview.unavailable':
        "This preview isn't available. Ask for a new preview link.",
    'preview.flow_unavailable':
        "Flows can't be previewed in the app yet; the studio's own preview "
        'shows them.',
    'form.submit': 'Send',
    'nav.menu': 'Menu',
    'list.group.none': 'Other',
    'sync.synced': 'Synced',
    'sync.pending': '{{count}} items waiting to upload',
    'sync.needs_attention': 'Needs attention',
    'sync.uploading_photos': 'Uploading photos: {{count}} to go',
    'sync.now': 'Sync now',
    'contact.call': 'Call',
    'contact.sms': 'SMS',
    'contact.email': 'Email',
    'contact.no_app': 'No app on this phone can open that.',
    'evidence.status.sent': 'All {{total}} uploaded',
    'evidence.status.waiting':
        '{{sent}} of {{total}} uploaded; the rest will send automatically',
    'evidence.status.held': '{{held}} of {{total}} need attention',
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
        '{{pending}} items are waiting to upload. They send automatically '
        "when you're back online; you don't need to do anything else.",
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
    'signature.too_short': 'Keep going: the signature is too short.',
    'signature.full': 'The pad is full. Tap Done, or Clear to start again.',
    'signature.signed_by': 'Signed by {{who}}',
    'signature.signer_first': 'Fill in who is signing first.',
    'signature.signer_changed':
        'Who is signing changed after this signature. Sign again.',
    'signature.sign_again_confirm':
        'Sign again? The earlier signature stays on record.',
    'inspection.declaration_accept': 'I accept this declaration',
    'inspection.declaration_version': 'Version {{version}}',
    'inspection.declaration_newer':
        'This declaration has changed since you accepted it. Read it and '
        'accept it again.',
    'inspection.declaration_changed':
        'The declaration has changed. Read the new version and accept it.',
    'inspection.location_first': 'Check your location first.',
    'inspection.paused':
        'You have left the premises, so the inspection is paused. Go back to '
        'carry on; your answers are kept.',
    'location.title': 'Location check',
    'location.checking': 'Checking that you are at the premises…',
    'location.waiting_fix': 'Waiting for a location fix…',
    'location.accuracy': 'Accurate to {{m}} m',
    'location.seconds_left': '{{s}} s left',
    'location.passed': 'You are at the premises.',
    'location.outside':
        'You seem to be {{m}} m from the premises. Move closer and try again.',
    'location.no_lock':
        "Your location isn't accurate enough here. Move to an open spot and "
        'try again.',
    'location.mocked': 'A mock location app is on. Turn it off and try again.',
    'location.needs_access':
        'POS needs your location to check that you are at the premises.',
    'location.allow': 'Allow location',
    'location.off': 'Location is off on this phone. Turn it on and try again.',
    'location.try_again': 'Try again',
    'location.approximate':
        'POS needs your precise location. Turn on Precise location for this '
        "app in your phone's settings, then try again.",
    'location.open_settings': 'Open settings',
    'address.line1': 'Street address',
    'address.line2': 'Unit, building or complex',
    'address.suburb': 'Suburb',
    'address.city': 'City or town',
    'address.province': 'Province',
    'address.postal_code': 'Postal code',
    'pin.title': 'Place the pin',
    'pin.hint': 'Move the map so the pin is on the entrance.',
    'pin.set': 'Set the pin',
    'pin.change': 'Move the pin',
    'pin.none': 'No pin yet.',
    'pin.at': 'Pin at {{lat}}, {{lng}}',
    'pin.use': 'Use this spot',
    'pin.my_location': 'My location',
    'form.error.address.PIN_REQUIRED': 'Set the pin on the map.',
    'form.error.address.INVALID_OPTION': 'Choose a province from the list.',
    'form.error.location_pin.TOO_FAR':
        "The pin is too far from the job's location.",
    'location.no_lock_outside':
        "Your location isn't accurate enough inside. Step outside the "
        'premises and record your location there.',
    'location.record_outside': 'Record my location outside',
    'location.recording_outside':
        'Recording your location outside the premises…',
    'checkin.title': 'Check in',
    'checkin.prompt':
        'GPS is often weak inside a site like this. Check in outside before '
        'you go in.',
    'checkin.explain':
        'Stand outside the premises, in the open, while the phone records '
        'where you are.',
    'checkin.button': 'Check in outside',
    'checkin.recording': 'Recording your location…',
    'checkin.done': 'Checked in outside.',
    'attention.title': 'Needs attention',
    'attention.explain':
        "The server couldn't accept these. Your data is safe on this phone, "
        'and an administrator has been told.',
    'attention.none': 'Nothing needs attention.',
    'attention.lost.title': "Work on this phone couldn't be opened",
    'attention.lost.unsent':
        "{{count}} items saved since {{at}} hadn't reached the server and "
        "can't be recovered on this phone. They're kept, and reported to "
        'your administrator.',
    'attention.lost.unknown':
        "Work saved on this phone before {{at}} couldn't be opened. It's "
        'kept, and reported to your administrator.',
    'attention.lost.ok': 'I understand',
    'attention.battery.title': 'Your phone may hold back sending',
    'attention.battery.body':
        "This phone's battery settings can stop POS sending your work while "
        "it's in the background. Let the app run without battery "
        'restrictions, then come back here.',
    'attention.battery.open': 'Open battery settings',
    'attention.saved_at': 'Saved {{at}}',
    'attention.reason': 'Reason: {{code}}',
    'attention.type.submission': 'Inspection submission',
    'attention.type.inspection_started': 'Inspection start',
    'attention.type.job_event': 'Job update',
    'attention.type.form_submission': 'Form',
    'attention.type.evidence_meta': 'Photo or signature record',
    'attention.type.evidence_uploaded': 'Upload record',
    'attention.type.traces_batch': 'Location trail',
    'attention.type.inspection_snapshot': 'Inspection snapshot',
    'attention.type.custody_batch': 'Custody record',
    'attention.type.sync_report': 'Sync report',
    'attention.type.client_error': 'Error report',
    'attention.type.other': 'Record',
    'location.override': 'Continue with an override',
    'location.override_too_far':
        "You're too far from the premises for an override. If you can't "
        'find them, mark the job unable to complete.',
    'override.title': 'Location override',
    'override.submit': 'Continue with the override',
    'inspection.declaration_missing':
        "This declaration hasn't reached your phone yet. Connect to the "
        'internet and try again.',
    'inspection.camera_unavailable':
        "The camera couldn't be opened. Check that FESS may use the camera.",
    'inspection.capture_failed': "This couldn't be saved. Try again.",
    'camera.explain.title': 'Photos for this inspection',
    'camera.explain.body':
        "POS takes the inspection's photos with the camera, here in the app. "
        "They're never taken from your gallery. Next, your phone asks whether "
        'FESS may use the camera: choose Allow.',
    'camera.explain.continue': 'Continue',
    'camera.denied':
        "FESS isn't allowed to use the camera. Turn camera access on in your "
        "phone's settings, then come back.",
    'camera.open_settings': 'Open settings',
    'camera.try_again': 'Try again',
    'camera.location_wait': 'Waiting for your location…',
    'camera.location_needed':
        'These photos need your location. Allow FESS to use it.',
    'camera.location_allow': 'Allow location',
    'camera.location_off': 'Turn on location on your phone for these photos.',
    'inspection.take_photos': 'Take photos',
    'photo.progress': 'Photo {{n}} of {{total}}',
    'photo.count': '{{n}} taken',
    'photo.count.min': '{{n}} taken · at least {{min}}',
    'photo.count.max': '{{n}} taken · up to {{max}}',
    'photo.count.range': '{{n}} taken · {{min}} to {{max}}',
    'photo.retake': 'Retake',
    'photo.remove': 'Remove',
    'photo.retake_confirm':
        'Replace this photo? The one you replace stays on record.',
    'photo.remove_confirm':
        'Remove this photo? It stays on record, but not in your answers.',
    'photo.caption.title': 'Caption',
    'photo.caption.hint': 'What does this photo show?',
    'photo.caption.save': 'Save',
    'photo.caption.skip': 'No caption',
    'photo.caption.discard': 'Discard photo',
    'form.error.RULE_ERROR':
        "This question couldn't be checked. Tell your administrator.",
    'form.error.VALIDATION_RULE_FAILED': 'Check this answer.',
    'form.error.BELOW_MIN': 'Enter {{min}} or more.',
    'form.error.ABOVE_MAX': 'Enter {{max}} or less.',
    'form.error.date.BELOW_MIN': 'Choose {{min}} or later.',
    'form.error.date.ABOVE_MAX': 'Choose {{max}} or earlier.',
    'form.error.time.BELOW_MIN': 'Choose {{min}} or later.',
    'form.error.time.ABOVE_MAX': 'Choose {{max}} or earlier.',
    'form.error.NOT_INTEGER': 'Enter a whole number.',
    'form.error.TOO_MANY_DECIMALS': 'Use at most {{decimals}} decimal places.',
    'form.error.INVALID_STEP': 'Use steps of {{step}}.',
    'form.error.OUT_OF_RANGE': 'This is outside the allowed range.',
    'form.error.percentage.OUT_OF_RANGE': 'Enter a percentage from 0 to 100.',
    'form.error.number.INVALID_TYPE': 'Enter a number.',
    'form.error.percentage.INVALID_TYPE': 'Enter a number.',
    'form.error.duration.INVALID_TYPE': 'Enter a whole number.',
    'form.error.INVALID_FORMAT': "This isn't in the right format.",
    'form.error.phone.INVALID_FORMAT':
        'Enter a phone number such as 082 123 4567.',
    'form.error.INVALID_UNIT': 'Choose a unit.',
    'form.error.MISSING_GROUP': 'Give the hours for every day listed.',
    'form.error.INVALID_HOURS':
        'Choose opening and closing times, or mark the day closed.',
    'form.error.acknowledgement.REQUIRED': 'Tick the box to continue.',
    'form.error.acknowledgement.NOT_ACCEPTED': 'Tick the box to continue.',
    'form.not_applicable': 'Not applicable',
    'form.clear': 'Clear',
    'form.date.choose': 'Choose a date',
    'form.date.unknown': "I don't know",
    'form.time.choose': 'Choose a time',
    'form.phone.hint': '082 123 4567',
    'form.duration.days': 'Days',
    'form.duration.months': 'Months',
    'form.duration.years': 'Years',
    'form.hours.weekdays': 'Monday to Friday',
    'form.hours.saturday': 'Saturday',
    'form.hours.sunday': 'Sunday',
    'form.hours.public_holidays': 'Public holidays',
    'form.hours.open': 'Open',
    'form.hours.closed': 'Closed',
    'form.hours.24h': 'Open 24 hours',
    'form.hours.opens': 'Opens',
    'form.hours.closes': 'Closes',
    'form.prefilled.differs': "This isn't what I see on site",
    'inspection.acknowledge_first':
        "Confirm you've read this before you go on.",
    'inspection.branch_unavailable':
        "This answer leads to a part of FESS this version can't open yet.",
    'summary.change': 'Change',
    'summary.unanswered': 'Not answered',
    'summary.unknown': "Don't know",
    'summary.photos': 'Photos: {{n}}',
    'summary.signed': 'Signed',
    'summary.accepted': 'Accepted',
    'summary.risk.info': 'Note',
    'summary.risk.elevated': 'Check this',
    'summary.risk.high': 'High risk',
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
