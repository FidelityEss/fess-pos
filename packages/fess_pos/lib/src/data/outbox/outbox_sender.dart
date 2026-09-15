import 'dart:convert';
import 'dart:math';

import 'package:fess_pos/src/contract/errors.dart';
import 'package:fess_pos/src/core/logging/pos_logger.dart';
import 'package:fess_pos/src/data/local/pos_database.dart';
import 'package:fess_pos/src/data/outbox/envelope.dart';
import 'package:fess_pos/src/data/outbox/outbox_store.dart';
import 'package:fess_pos/src/data/remote/api_exception.dart';
import 'package:fess_pos/src/data/remote/pos_api_client.dart';
import 'package:fess_pos/src/data/remote/retry_policy.dart';
import 'package:meta/meta.dart';

const PosLogger _log = PosLogger('outbox');

/// What one [OutboxSender.drain] did.
@immutable
class DrainReport {
  const DrainReport({
    this.sent = 0,
    this.outcomes = const {},
    this.stoppedBy,
    this.heldUsers = const {},
  });

  /// Envelopes that got a receipt.
  final int sent;

  /// Item states after their receipts, e.g. `committed: 3`.
  final Map<String, int> outcomes;

  /// The error that ended the drain early (items are rescheduled).
  final String? stoppedBy;

  /// Users whose items wait for the host to sign them in again.
  final Set<String> heldUsers;
}

enum _Next { more, stop, holdUser }

/// Sends the outbox (docs/08 §3, docs/12 §4): due items in lane order,
/// batched per user, until nothing is due or the API can't be reached.
///
/// - A receipt decides each item's state; `stored_hash` must match.
/// - No answer, a 5xx or a 429: the batch waits with full-jitter backoff,
///   forever. A batch too large is split. A session that ended holds that
///   user's items, unchanged, until they sign in again.
/// - An item the server will never take as it is gets parked and reported;
///   nothing is dropped.
class OutboxSender {
  OutboxSender({
    required this.store,
    required this.client,
    this.backoff = const Backoff(),
    Random? random,
  }) : _random = random ?? Random();

  /// Batches per drain, so one drain can't run for ever.
  static const int maxBatchesPerDrain = 100;

  final OutboxStore store;
  final PosApiClient client;
  final Backoff backoff;
  final Random _random;
  Future<DrainReport>? _running;

  /// Sends what is due. Concurrent calls share one drain.
  Future<DrainReport> drain() => _running ??= _drain().whenComplete(() {
    _running = null;
  });

  Future<DrainReport> _drain() async {
    var sent = 0;
    final outcomes = <String, int>{};
    final held = <String>{};
    String? stoppedBy;
    for (var i = 0; i < maxBatchesPerDrain; i++) {
      final book = await client.vault.read();
      final batch = await store.nextBatch(
        sendAs: (itemUser) {
          final id = itemUser ?? book.activeUserId;
          if (id == null || held.contains(id)) return null;
          final session = book.sessions[id];
          return session != null && session.usable ? id : null;
        },
      );
      if (batch == null) break;
      final (next, receipts, error) = await _send(batch.rows, batch.userId);
      sent += receipts.values.fold(0, (a, b) => a + b);
      receipts.forEach((k, v) => outcomes[k] = (outcomes[k] ?? 0) + v);
      if (next == _Next.holdUser) {
        held.add(batch.userId);
      } else if (next == _Next.stop) {
        stoppedBy = error;
        break;
      }
    }
    return DrainReport(
      sent: sent,
      outcomes: outcomes,
      stoppedBy: stoppedBy,
      heldUsers: held,
    );
  }

  Future<(_Next, Map<String, int>, String?)> _send(
    List<OutboxRow> rows,
    String userId,
  ) async {
    await store.markInFlight(rows);
    try {
      final response = await client.ingest([
        for (final r in rows) jsonDecode(r.envelope) as Map<String, Object?>,
      ], userId: userId);
      final raw = response.body['receipts'];
      final receipts = raw is List<Object?>
          ? raw.map(IngestReceipt.tryParse).toList()
          : const <IngestReceipt?>[];
      if (receipts.length != rows.length || receipts.contains(null)) {
        _log.error(
          'ingest answered ${receipts.length} receipts for ${rows.length} '
          'envelopes; sending again later',
        );
        await _later(rows, null, PosErrorCodes.responseMalformed);
        return (
          _Next.stop,
          const <String, int>{},
          PosErrorCodes.responseMalformed,
        );
      }
      final counts = await store.applyReceipts(
        rows,
        receipts.cast<IngestReceipt>(),
      );
      return (_Next.more, counts, null);
    } on PosException catch (e) {
      switch (classifyFailure(e)) {
        case FailureAction.splitBatch || FailureAction.park:
          if (rows.length == 1) {
            await store.park(rows.single, e);
            return (_Next.more, {OutboxState.needsAttention: 1}, null);
          }
          final half = rows.length ~/ 2;
          final first = await _send(rows.sublist(0, half), userId);
          if (first.$1 != _Next.more) {
            await store.release(rows.sublist(half));
            return first;
          }
          final second = await _send(rows.sublist(half), userId);
          return (second.$1, _sum(first.$2, second.$2), second.$3);
        case FailureAction.signInAgain:
          await store.release(rows);
          _log.info('uploads wait for a new sign-in (${e.code})');
          return (_Next.holdUser, const <String, int>{}, e.code);
        case FailureAction.retry ||
            FailureAction.refreshSession ||
            FailureAction.denied:
          await _later(
            rows,
            e is PosApiException ? e.retryAfter : null,
            e.code,
          );
          return (_Next.stop, const <String, int>{}, e.code);
      }
    } on Object catch (e, st) {
      // A bug on this side: keep everything and try again later.
      _log.error('sending the outbox failed', error: e, stackTrace: st);
      await _later(rows, null, 'CLIENT_ERROR');
      return (_Next.stop, const <String, int>{}, 'CLIENT_ERROR');
    }
  }

  Future<void> _later(
    List<OutboxRow> rows,
    Duration? retryAfter,
    String error,
  ) => store.reschedule(
    rows,
    delayFor: (attempt) =>
        backoff.delay(attempt, retryAfter: retryAfter, random: _random),
    error: error,
  );

  static Map<String, int> _sum(Map<String, int> a, Map<String, int> b) => {
    ...a,
    for (final e in b.entries) e.key: (a[e.key] ?? 0) + e.value,
  };
}
