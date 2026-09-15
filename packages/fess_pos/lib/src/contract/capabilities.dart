/// What this build of the module can show (docs/04 §8, `11`): each form
/// component, view component, flow step and page type with its version.
/// It goes into the capability report sent at sign-in, with every device
/// update and with every pull, so the server knows what this phone can be
/// given and the studio can tell who needs an update.
library;

/// Form components (`11` §3–5). Still to come: the Wave-2 components
/// (T6-01). A field of another type is drawn as its declared `fallback`
/// when this build can draw that.
const Map<String, int> supportedFormComponents = {
  'text': 1,
  'textarea': 1,
  'number': 1,
  'percentage': 1,
  'phone': 1,
  'boolean': 1,
  'tri_state': 1,
  'single_select': 1,
  'multi_select': 1,
  'date': 1,
  'time': 1,
  'duration': 1,
  'business_hours': 1,
  'info': 1,
  'callout': 1,
  'divider': 1,
  'prefilled': 1,
  'group': 1,
  'photo': 1,
  'signature': 1,
  'declaration': 1,
  'acknowledgement': 1,
  'address': 1,
  'location_pin': 1,
};

/// Components drawn only inside an inspection, which brings the camera,
/// the signature pad, the declarations (T4-27) and the map for a pin
/// (T4-11). Elsewhere, e.g. an unable reason that needs a photo, they hold
/// the form as unsupported.
const Set<String> inspectionOnlyComponents = {
  'photo',
  'signature',
  'declaration',
  'location_pin',
};

/// View components (`11` §7.2). Still to come: `action_button` and `image`
/// (T3-05), `evidence_status` (T4-13). An item this build can't draw is
/// left out; the rest of the view still shows.
const Map<String, int> supportedViewComponents = {
  'agent_card': 1,
  'agent_card_summary': 1,
  'job_card': 1,
  'map_preview': 1,
  'title': 1,
  'field_value': 1,
  'address_block': 1,
  'schedule_window': 1,
  'status_chip': 1,
  'badge': 1,
  'markdown': 1,
  'divider': 1,
  'contact': 1,
  'greeting': 1,
  'section_title': 1,
  'stat_row': 1,
  'stat_tile': 1,
  'job_list': 1,
  'sync_status': 1,
  'announcement': 1,
};

/// Flow steps (`11` §6). `location_check` passes on its own until its gate
/// arrives (T4-07).
const Map<String, int> supportedFlowSteps = {
  'job_briefing': 1,
  'location_check': 1,
  'form': 1,
  'summary_review': 1,
  'declaration': 1,
  'submit': 1,
  'receipt': 1,
};

/// Page types (`11` §7.1). `list_page` comes with the app definition
/// driving navigation (T3-17).
const Map<String, int> supportedPageTypes = {
  'view_page': 1,
  'form_page': 1,
  'flow': 1,
  'outcome_page': 1,
};
