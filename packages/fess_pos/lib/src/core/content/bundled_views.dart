/// Bundled default views, used until the server's arrive (docs/04 §3.6,
/// "safe fallback"): enough to list the agent's jobs and open one on a
/// first run. They're data, like the server's; the `view` definitions the
/// pull brings replace them.
abstract final class BundledViews {
  /// The home page (B2.9): the greeting, the card, tiles counted from the
  /// jobs on the phone plus the server's total for today, the active leads
  /// and the sync status. It works offline from the first run.
  static const List<Object?> home = [
    {'type': 'greeting', 'text': 'Hi {{agent.first_name}}'},
    {
      'type': 'agent_card_summary',
      'on_tap': {'page': 'agent_card'},
    },
    {
      'type': 'stat_row',
      'tiles': [
        {
          'type': 'stat_tile',
          'label': 'Active',
          'source': 'local',
          'collection': 'jobs',
          'filter': {
            'in': [
              {'var': 'job.status'},
              _activeStatuses,
            ],
          },
        },
        {
          'type': 'stat_tile',
          'label': 'Due today',
          'source': 'server',
          'stat': 'stats.due_today',
        },
        {
          'type': 'stat_tile',
          'label': 'Returned',
          'source': 'local',
          'collection': 'jobs',
          'filter': {
            '==': [
              {'var': 'job.status'},
              'returned',
            ],
          },
        },
      ],
    },
    {'type': 'section_title', 'text': 'Your leads'},
    {
      'type': 'job_list',
      'item_view': 'job_card',
      'filter': {
        'in': [
          {'var': 'job.status'},
          _activeStatuses,
        ],
      },
      'sort': 'job.scheduled_start',
      'on_tap': {'page': 'job_detail'},
      'empty_content': 'jobs.empty_active',
    },
    // Synced, pending, or what needs attention (docs/08 §8).
    {'type': 'sync_status'},
  ];

  /// The statuses of a job the agent still has work on.
  static const List<Object?> _activeStatuses = [
    'assigned',
    'accepted',
    'in_progress',
    'paused',
    'returned',
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
