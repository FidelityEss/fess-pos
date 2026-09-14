import 'package:fess_pos/src/core/version.dart';
import 'package:meta/meta.dart';

/// Send lanes (docs/08 §3): for timeliness, not correctness. The server
/// takes envelopes in any order.
abstract final class OutboxLane {
  /// An agent's decisions and submissions.
  static const int actions = 1;

  /// Evidence records.
  static const int evidence = 2;

  /// Reports about the device and the sync itself.
  static const int reports = 3;

  /// Bulk data: location traces, in-progress snapshots.
  static const int bulk = 4;

  static int forType(String type) => switch (type) {
    'submission' ||
    'job_event' ||
    'inspection_started' ||
    'form_submission' ||
    'lead_created' => actions,
    'evidence_meta' || 'evidence_uploaded' => evidence,
    'traces_batch' || 'inspection_snapshot' => bulk,
    _ => reports,
  };
}

/// The state of an outbox item (docs/08 §1).
abstract final class OutboxState {
  /// Waiting to be sent.
  static const String queued = 'queued';

  /// Being sent now. An item left in flight when the app stopped goes back
  /// to queued on the next start and is sent again; landing is idempotent.
  static const String inFlight = 'in_flight';

  /// The server holds it (deferred or still processing). Not sent again,
  /// except after a restore (`server_epoch`). The pull reports the outcome.
  static const String durable = 'durable';

  /// Landed and applied.
  static const String committed = 'committed';

  /// Rejected, a conflict, or refused at the door. Kept until the server's
  /// resolution is pulled; never sent again on its own.
  static const String needsAttention = 'needs_attention';

  /// Not yet known to be held by the server.
  static const List<String> pending = [queued, inFlight];
}

/// The envelope wrapper (`schema/api/envelope.schema.json`, docs/12 §4).
/// Built once, when the action happens, and sent unchanged on every retry.
Map<String, Object?> envelopeJson({
  required String id,
  required String type,
  required int typeVersion,
  required String payloadHash,
  required String deviceId,
  required String? sessionId,
  required int deviceSeq,
  required String clientType,
  required String createdAtDevice,
  required int monotonicMs,
  required Map<String, Object?> payload,
}) => {
  'api_version': PosVersions.api,
  'id': id,
  'type': type,
  'type_version': typeVersion,
  'payload_hash': payloadHash,
  'device_id': deviceId,
  'session_id': sessionId,
  'device_seq': deviceSeq,
  'module_version': PosVersions.module,
  'client_type': clientType,
  'created_at_device': createdAtDevice,
  'monotonic_ms': monotonicMs,
  'payload': payload,
};

/// One receipt (`schema/api/receipt.schema.json`), read defensively: a
/// state a newer server invents is kept as it is.
@immutable
class IngestReceipt {
  const IngestReceipt({
    required this.id,
    required this.state,
    required this.durable,
    required this.raw,
    this.storedHash,
    this.error,
  });

  /// Null when [json] isn't a receipt object.
  static IngestReceipt? tryParse(Object? json) {
    if (json is! Map<String, Object?>) return null;
    final id = json['id'];
    final state = json['state'];
    final storedHash = json['stored_hash'];
    final error = json['error'];
    return IngestReceipt(
      id: id is String ? id : null,
      state: state is String ? state : null,
      durable: json['durable'] == true,
      storedHash: storedHash is String ? storedHash : null,
      error: error is Map<String, Object?> ? error : null,
      raw: json,
    );
  }

  final String? id;

  /// `received`, `committed`, `duplicate`, `deferred`, `rejected`,
  /// `conflict`, or null when the wrapper was refused at the door.
  final String? state;
  final bool durable;
  final String? storedHash;
  final Map<String, Object?>? error;
  final Map<String, Object?> raw;

  String? get errorCode {
    final code = error?['code'];
    return code is String ? code : null;
  }
}
