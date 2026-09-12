-- Global reference data and default configuration (T1-11). Every row here is ordinary configuration, editable in
-- the admin panel afterwards; nothing is referenced by code. Idempotent (safe to run on any environment once).

-- ── Server settings ────────────────────────────────────────────────────────────────────────────
insert into pos.settings (key, value, note) values
  ('notify.providers', '{"push": "log", "email": "log", "email_from": null}'::jsonb,
   'Delivery adapters (D-06, D-17). "log" records the would-be send and calls nobody.')
on conflict (key) do nothing;

-- ── Trusted issuers (docs/07 §2, D-05) ─────────────────────────────────────────────────────────
-- pos_dev: stand-in identity provider for dev/staging (instructions §10.5). Refused by the API when POS_ENV=production.
-- fess_*: shapes from findings/01; seeded INACTIVE, with no endpoint configured. Only a human enables them, once
-- the FESS team has provided the server-to-server credential.
insert into pos.trusted_issuers (key, type, title, issuer, audience, jwks_url, introspection_url, request_template,
                                 subject_claim, employee_number_source, secret_name, primary_issuer, active) values
  ('pos_dev', 'dev_stub', 'Stand-in identity provider (dev/staging only)', 'pos-dev-issuer', 'fess-pos', null, null, '{}',
   'sub', '{"claim": "employee_number"}', null, true, true),
  ('fess_auth_api', 'introspection', 'FESS auth API — getEmployeeDetails (primary)', null, null, null, null,
   '{"method": "POST", "headers": {"content-type": "application/json", "authorization": "Bearer {{secret}}"},
     "body": {"type": "getEmployeeDetails", "body": {}, "token": "{{token}}"},
     "success_path": "personnelNumber", "subject_path": "personnelNumber",
     "names": {"first_name": "firstName", "last_name": "surname"}, "timeout_ms": 8000}',
   null, '{"type": "issuer_lookup", "path": "personnelNumber"}', 'FESS_AUTH_API_CREDENTIAL', true, false),
  ('fess_firebase', 'jwks', 'FESS Firebase ID token (secondary signal only — never sufficient alone)',
   'https://securetoken.google.com/fess-a6f94', 'fess-a6f94',
   'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com', null, '{}',
   'sub', '{"type": "none"}', null, false, false)
on conflict (key) do nothing;

-- ── Reason codes (docs/06 §3). `billable` defaults are provisional (D-43) and overridable per bank ──
insert into pos.reason_codes (category, code, label, requires_note, requires_photo, billable, sort_order) values
  ('assignment_reject', 'unavailable', 'I am not available at that time', false, false, false, 10),
  ('assignment_reject', 'too_far', 'Too far from my area', false, false, false, 20),
  ('assignment_reject', 'conflict', 'Conflict of interest', true, false, false, 30),
  ('assignment_reject', 'safety', 'Safety concern', true, false, false, 40),
  ('assignment_reject', 'other', 'Other', true, false, false, 90),
  ('unable_to_complete', 'business_closed', 'Business closed', false, false, true, 10),
  ('unable_to_complete', 'owner_unavailable', 'Owner / contact unavailable', false, false, true, 20),
  ('unable_to_complete', 'safety_concern', 'Safety concern on site', true, false, false, 30),
  ('unable_to_complete', 'incorrect_address', 'Incorrect address', false, true, true, 40),
  ('unable_to_complete', 'access_denied', 'Access denied', false, false, true, 50),
  ('unable_to_complete', 'premises_not_found', 'Premises not found', false, true, true, 60),
  ('unable_to_complete', 'other', 'Other', true, false, false, 90),
  ('cancel', 'bank_withdrew', 'Bank withdrew the request', false, false, false, 10),
  ('cancel', 'duplicate', 'Duplicate job', false, false, false, 20),
  ('cancel', 'merchant_withdrew', 'Merchant withdrew', false, false, false, 30),
  ('cancel', 'created_in_error', 'Created in error', false, false, false, 40),
  ('cancel', 'other', 'Other', true, false, false, 90),
  ('geofence_override', 'gps_inaccurate_indoors', 'GPS inaccurate indoors', true, true, false, 10),
  ('geofence_override', 'coordinates_incorrect', 'Job coordinates are wrong', true, true, false, 20),
  ('geofence_override', 'large_premises', 'Large premises', true, true, false, 30),
  ('geofence_override', 'other', 'Other', true, true, false, 90),
  ('review_return', 'photos_insufficient', 'Photos insufficient', false, false, false, 10),
  ('review_return', 'answers_incomplete', 'Answers incomplete', false, false, false, 20),
  ('review_return', 'signature_missing', 'Signature missing', false, false, false, 30),
  ('review_return', 'evidence_unclear', 'Evidence unclear', false, false, false, 40),
  ('review_return', 'other', 'Other', true, false, false, 90),
  ('review_reject', 'merchant_not_legitimate', 'Merchant not legitimate', true, false, true, 10),
  ('review_reject', 'unable_to_verify', 'Unable to verify', true, false, true, 20),
  ('review_reject', 'integrity_failure', 'Integrity failure', true, false, false, 30),
  ('review_reject', 'other', 'Other', true, false, false, 90),
  ('appointment_not_secured', 'merchant_unreachable', 'Merchant unreachable', true, false, true, 10),
  ('appointment_not_secured', 'merchant_declined', 'Merchant declined', true, false, true, 20),
  ('appointment_not_secured', 'wrong_contact_details', 'Wrong contact details', true, false, true, 30),
  ('appointment_not_secured', 'business_closed_permanently', 'Business closed permanently', true, false, true, 40),
  ('appointment_not_secured', 'other', 'Other', true, false, false, 90),
  ('reassign', 'agent_unavailable', 'Agent unavailable', false, false, false, 10),
  ('reassign', 'workload', 'Workload balancing', false, false, false, 20),
  ('reassign', 'no_response', 'Agent did not respond', false, false, false, 30),
  ('reassign', 'other', 'Other', true, false, false, 90),
  ('unschedule', 'merchant_cancelled_appointment', 'Merchant cancelled the appointment', false, false, false, 10),
  ('unschedule', 'agent_capacity', 'No agent capacity for the window', false, false, false, 20),
  ('unschedule', 'other', 'Other', true, false, false, 90),
  ('envelope_resolution', 'reprocessed_after_fix', 'Reprocessed after a definition or code fix', false, false, false, 10),
  ('envelope_resolution', 'attached_to_job', 'Attached to the correct job', false, false, false, 20),
  ('envelope_resolution', 'duplicate_confirmed', 'Confirmed duplicate', false, false, false, 30),
  ('envelope_resolution', 'other', 'Other', true, false, false, 90)
on conflict do nothing;

-- ── MCC codes (common acquiring categories; risk tiers are provisional starting values, editable) ──
insert into pos.mcc_codes (code, description, risk_tier) values
  ('1520', 'General contractors — residential and commercial', 'standard'),
  ('4111', 'Local and suburban commuter transport', 'standard'),
  ('4121', 'Taxicabs and limousines', 'standard'),
  ('4814', 'Telecommunication services', 'elevated'),
  ('4816', 'Computer network / information services', 'elevated'),
  ('4829', 'Money transfer', 'high'),
  ('5047', 'Medical, dental and hospital equipment', 'standard'),
  ('5094', 'Precious stones, metals, watches and jewellery', 'high'),
  ('5122', 'Drugs, drug proprietaries and druggist sundries', 'elevated'),
  ('5172', 'Petroleum and petroleum products', 'standard'),
  ('5200', 'Home supply warehouse stores', 'standard'),
  ('5251', 'Hardware stores', 'standard'),
  ('5310', 'Discount stores', 'standard'),
  ('5311', 'Department stores', 'standard'),
  ('5331', 'Variety stores', 'standard'),
  ('5399', 'Miscellaneous general merchandise', 'standard'),
  ('5411', 'Grocery stores and supermarkets', 'low'),
  ('5422', 'Freezer and locker meat provisioners', 'standard'),
  ('5441', 'Candy, nut and confectionery stores', 'standard'),
  ('5451', 'Dairy products stores', 'standard'),
  ('5462', 'Bakeries', 'low'),
  ('5499', 'Miscellaneous food stores — convenience stores and specialty markets', 'standard'),
  ('5541', 'Service stations', 'standard'),
  ('5542', 'Automated fuel dispensers', 'standard'),
  ('5651', 'Family clothing stores', 'standard'),
  ('5661', 'Shoe stores', 'standard'),
  ('5691', 'Men''s and women''s clothing stores', 'standard'),
  ('5712', 'Furniture and home furnishings', 'standard'),
  ('5722', 'Household appliance stores', 'standard'),
  ('5732', 'Electronics stores', 'elevated'),
  ('5734', 'Computer software stores', 'standard'),
  ('5812', 'Eating places and restaurants', 'low'),
  ('5814', 'Fast food restaurants', 'low'),
  ('5816', 'Digital goods — games', 'elevated'),
  ('5818', 'Digital goods — large digital goods merchant', 'elevated'),
  ('5912', 'Drug stores and pharmacies', 'standard'),
  ('5921', 'Package stores — beer, wine and liquor', 'elevated'),
  ('5941', 'Sporting goods stores', 'standard'),
  ('5944', 'Jewellery, watch, clock and silverware stores', 'high'),
  ('5945', 'Hobby, toy and game shops', 'standard'),
  ('5966', 'Direct marketing — outbound telemarketing', 'high'),
  ('5967', 'Direct marketing — inbound teleservices', 'high'),
  ('5968', 'Direct marketing — continuity / subscription', 'elevated'),
  ('5977', 'Cosmetic stores', 'standard'),
  ('5992', 'Florists', 'standard'),
  ('5993', 'Cigar stores and stands', 'standard'),
  ('5999', 'Miscellaneous and specialty retail stores', 'standard'),
  ('6011', 'Automated cash disbursements', 'high'),
  ('6051', 'Non-financial institutions — quasi-cash', 'high'),
  ('7011', 'Hotels, motels and resorts', 'standard'),
  ('7230', 'Beauty and barber shops', 'low'),
  ('7299', 'Miscellaneous personal services', 'standard'),
  ('7349', 'Cleaning, maintenance and janitorial services', 'standard'),
  ('7399', 'Business services', 'standard'),
  ('7538', 'Automotive service shops', 'standard'),
  ('7542', 'Car washes', 'standard'),
  ('7832', 'Motion picture theatres', 'standard'),
  ('7995', 'Betting, including lottery tickets and casino chips', 'high'),
  ('8011', 'Doctors', 'low'),
  ('8021', 'Dentists and orthodontists', 'low'),
  ('8062', 'Hospitals', 'low'),
  ('8099', 'Medical services and health practitioners', 'standard'),
  ('8211', 'Elementary and secondary schools', 'low'),
  ('8220', 'Colleges and universities', 'low'),
  ('8398', 'Charitable and social service organisations', 'elevated')
on conflict (code) do nothing;

-- ── Agent declaration v1 — DRAFT wording pending Tuminc/Fidelity (D-12); new versions are admin actions ──
insert into pos.declarations (key, version, title, text, hash)
select 'agent_declaration', 1, 'Agent declaration', t, pos.sha256_hex(t)
  from (select 'DRAFT — wording pending confirmation (D-12). I declare that I personally visited these premises at the time '
            || 'recorded; that every photograph in this inspection was taken by me with this device on site during the visit; '
            || 'that the answers I have given are true and complete to the best of my knowledge; and that I have no personal '
            || 'or financial interest in this merchant. I understand that this record may be relied on by the acquiring bank.' as t) s
on conflict (key, version) do nothing;

insert into pos.declarations (key, version, title, text, hash)
select 'merchant_certification', 1, 'Merchant certification', t, pos.sha256_hex(t)
  from (select 'DRAFT — wording pending confirmation (D-12). I confirm that the information given to the agent about this '
            || 'business is true and correct, and I consent to the photographs taken of these premises for the purpose of '
            || 'verifying this merchant application.' as t) s
on conflict (key, version) do nothing;

-- ── Module release registry (docs/13 §3) ───────────────────────────────────────────────────────
insert into pos.module_releases (version, status, api_versions, spec_range, components, notes) values
  ('0.1.0', 'supported', array['1'], '1.x', '{}', 'Pre-pilot development build')
on conflict (version) do nothing;

-- Remote config global layer v1 and the global default definitions are generated (engine-validated, engine-hashed)
-- into 20_definitions.sql by tools/seed/build-definitions.mjs.
