import 'package:fess_pos/src/data/outbox/outbox_store.dart';
import 'package:meta/meta.dart';

/// The envelope an action records, returned by [ActionRecorder.record]'s
/// `apply` once the domain change is written.
@immutable
class PendingEnvelope {
  const PendingEnvelope({
    required this.type,
    required this.typeVersion,
    required this.payload,
    this.entityRef,
  });

  final String type;
  final int typeVersion;
  final Map<String, Object?> payload;

  /// The record it is about, e.g. `job:<id>`.
  final String? entityRef;
}

enum ActionStatus {
  /// The change and its envelope were written.
  recorded,

  /// The local state didn't allow it (e.g. already accepted); nothing was
  /// written.
  notAllowed,
}

@immutable
class ActionOutcome {
  const ActionOutcome.recorded(String this.envelopeId)
    : status = ActionStatus.recorded;

  const ActionOutcome.notAllowed()
    : status = ActionStatus.notAllowed,
      envelopeId = null;

  final ActionStatus status;
  final String? envelopeId;
}

/// Records an agent action exactly once (docs/12 §15, layer 1; docs/08 §3).
///
/// Two guards, so a double tap on a slow phone makes one envelope, not two:
/// - **one at a time per action:** a second call with the same key while
///   the first runs gets the first call's outcome;
/// - **the local state machine:** `allowed` is checked inside the same
///   transaction that writes the change and its envelope, so a tap after
///   the first finished finds the state already moved and writes nothing.
///
/// Every envelope also carries the next `device_seq` (the outbox adds it).
/// Screens use [isRunning] to disable the button while an action is in
/// flight.
class ActionRecorder {
  ActionRecorder(this._outbox);

  final OutboxStore _outbox;
  final Map<String, Future<ActionOutcome>> _running = {};

  bool isRunning(String key) => _running.containsKey(key);

  /// [key] names the action and its subject, e.g. `accept:job:<id>`.
  /// [allowed] reads the local state; [apply] writes the domain change and
  /// returns the envelope that records it. Both run in one transaction with
  /// the envelope, so all of it is stored or none of it is.
  Future<ActionOutcome> record({
    required String key,
    required EnvelopeOrigin origin,
    required Future<bool> Function() allowed,
    required Future<PendingEnvelope> Function() apply,
  }) => _running[key] ??= _record(origin, allowed, apply).whenComplete(() {
    _running.remove(key);
  });

  Future<ActionOutcome> _record(
    EnvelopeOrigin origin,
    Future<bool> Function() allowed,
    Future<PendingEnvelope> Function() apply,
  ) => _outbox.database.transaction(() async {
    if (!await allowed()) return const ActionOutcome.notAllowed();
    final envelope = await apply();
    final id = await _outbox.add(
      origin,
      type: envelope.type,
      typeVersion: envelope.typeVersion,
      payload: envelope.payload,
      entityRef: envelope.entityRef,
    );
    return ActionOutcome.recorded(id);
  });
}
