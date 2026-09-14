/// A `POST /v1/sync/pull` answer
/// (`schema/api/sync-pull-response.schema.json`) with what a test sets.
Map<String, Object?> pullPage({
  required DateTime serverTime,
  String epoch = 'e1111111-1111-4111-8111-111111111111',
  Map<String, Object?>? configValues,
  String? configVersion,
  Map<String, Object?> byBank = const {},
  List<Map<String, Object?>> envelopes = const [],
  String? envelopesCursor,
  bool envelopesMore = false,
  bool jobsMore = false,
  List<Map<String, Object?>> commands = const [],
  Object? reasonItems,
  String reasonHash = 'rh1',
  Map<String, Object?>? agentCard,
}) => {
  'server_time': serverTime.toUtc().toIso8601String(),
  'server_epoch': epoch,
  'me': {
    'id': 'u-1',
    'employee_number': 'E0001',
    'first_name': 'Test',
    'last_name': 'Agent',
    'role': 'pos_agent',
  },
  'jobs': {
    'items': <Object>[],
    'next_cursor': jobsMore ? '2026-09-14T08:00:00Z|j' : null,
    'has_more': jobsMore,
  },
  'definitions': {'manifest': <Object>[], 'bodies': <Object>[]},
  'lookup_lists': {'manifest': <Object>[], 'bodies': <Object>[]},
  'declarations': {'manifest': <Object>[], 'bodies': <Object>[]},
  'reason_codes': {'hash': reasonHash, 'items': reasonItems},
  'reviews': {'items': <Object>[], 'next_cursor': null, 'has_more': false},
  'evidence': {'items': <Object>[], 'next_cursor': null, 'has_more': false},
  'envelopes': {
    'items': envelopes,
    'next_cursor': envelopesCursor,
    'has_more': envelopesMore,
  },
  'agent_totals': {'active': 2, 'due_today': 1},
  'commands': commands,
  'session_tokens': <Object>[],
  'job_cards': <Object>[],
  'agent_card': agentCard,
  'config': {
    'default': {
      'config_version_id': configVersion,
      'values':
          configValues ??
          {
            'pos': {'enabled': true},
          },
    },
    'by_bank': byBank,
  },
};
