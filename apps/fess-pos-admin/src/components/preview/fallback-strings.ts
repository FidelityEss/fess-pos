// Fallback content strings for the phone preview (T3-23): a copy of the seeded global `core` content definition
// (fess-pos/supabase/seed/definitions/app_content.json). Used only when the caller passes no `bundle.strings`, so a
// preview still reads naturally. The real strings always come from the content definitions.
export const FALLBACK_CORE_STRINGS: Readonly<Record<string, string>> = {
  'jobs.empty_active': 'No active leads. New assignments appear here.',
  'sync.synced': 'Synced',
  'sync.pending': '{{count}} items waiting to upload',
  'sync.needs_attention': 'Needs attention',
  'receipt.received': 'Received by server ✓ {{time}} · {{verified}}/{{expected}} photos verified',
  'receipt.uploading': 'Received · {{remaining}} photos still uploading',
  'receipt.saved': 'Saved on this phone · {{count}} items waiting — connect to the internet',
  'location.outside_fence': "You're outside the expected location for this merchant.",
  'location.sampling': 'Getting an accurate location… accuracy {{accuracy}} m',
  'location.checkin_prompt': 'Record your location outside the premises before you go in.',
  'update.required': 'Update FESS to start this inspection. Anything already captured will still upload.',
  'verify.page_title': 'POS agent verification',
  'verify.valid_heading': 'Authorised POS agent',
  'verify.valid_body': 'This person is currently authorised to carry out merchant site verifications.',
  'verify.job_heading': 'Authorised for this visit',
  'verify.invalid_heading': 'Not verified',
  'verify.invalid_body': 'This card could not be verified. Do not allow the visit to continue, and report your concern.',
  'verify.report_concern': 'Report a concern to your bank or to Fidelity Security Services.',
  'verify.valid_until': 'Valid until',
};

/** Sample values for `{{placeholders}}` in content strings (the phone fills them at runtime). */
export const SAMPLE_PLACEHOLDER_VALUES: Readonly<Record<string, string | number>> = {
  count: 3,
  time: '14:32',
  verified: 5,
  expected: 5,
  remaining: 2,
  accuracy: 12,
  job_reference: 'POS-2026-000042',
  first_name: 'Gugu',
  merchant_name: "Mama Joy's Spaza",
  note: 'Please retake the shopfront photo so the unit number is readable.',
  reason_code: 'too_far',
};
