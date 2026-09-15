/// Bundled default views, used until the server's arrive (docs/04 §3.6,
/// "safe fallback"): enough to list the agent's jobs and open one on a
/// first run. They're data, like the server's; the `view` definitions the
/// pull brings replace them.
abstract final class BundledViews {
  static const List<Object?> home = [
    {
      'type': 'agent_card_summary',
      'on_tap': {'page': 'agent_card'},
    },
    {
      'type': 'job_list',
      'item_view': 'job_card',
      'sort': 'job.scheduled_start',
      'on_tap': {'page': 'job_detail'},
      'empty_content': 'jobs.empty_active',
    },
    // Synced, pending, or what needs attention (docs/08 §8).
    {'type': 'sync_status'},
  ];

  static const List<Object?> jobCard = [
    {'type': 'title', 'bind': 'job.merchant_name'},
    {'type': 'status_chip', 'bind': 'job.status'},
    {'type': 'field_value', 'label': 'Ref', 'bind': 'job.reference'},
    {'type': 'schedule_window', 'bind': 'job.scheduled'},
  ];

  static const List<Object?> jobDetail = [
    {'type': 'title', 'bind': 'job.merchant_name'},
    {'type': 'status_chip', 'bind': 'job.status'},
    {'type': 'field_value', 'label': 'Reference', 'bind': 'job.reference'},
    {
      'type': 'schedule_window',
      'label': 'Visit window',
      'bind': 'job.scheduled',
    },
    {'type': 'address_block', 'label': 'Address', 'bind': 'job.address'},
    {'type': 'map_preview', 'bind': 'job.location', 'height': 180},
    // How the last inspection's uploads are getting on (the receipt).
    {
      'type': 'evidence_status',
      'label': 'Evidence',
      'bind': 'inspection.evidence',
    },
    {'type': 'job_card', 'show_photo': true, 'show_qr': true},
  ];

  static const List<Object?> agentCard = [
    {'type': 'agent_card', 'show_photo': true, 'show_qr': true},
  ];

  /// The bundled items of a view by key, or null when none is bundled.
  static List<Object?>? byKey(String key) => switch (key) {
    'home' => home,
    'job_card' => jobCard,
    'job_detail' => jobDetail,
    'agent_card' => agentCard,
    _ => null,
  };
}
