import 'package:fess_pos/src/contract/host_config.dart';
import 'package:fess_pos/src/core/logging/pos_logger.dart';
import 'package:fess_pos/src/core/time/device_time.dart';
import 'package:fess_pos/src/data/local/pos_database.dart';
import 'package:fess_pos/src/data/remote/pos_api_client.dart';
import 'package:fess_pos_engine/fess_pos_engine.dart' show sha256Hex;

const PosLogger _log = PosLogger('push');

/// Recorded after unregistering.
const String _none = 'none';

/// Keeps this device's push registration with the POS API in step with the
/// host's token (docs/03 §3, D-50; T2-19). Push only hints that there is
/// something to sync, so none of this is on any data path.
///
/// What should be registered for the active user: the host's current token
/// while their session can show POS, nothing once it can't (they signed out,
/// or the server narrowed the session). What was last sent is recorded per
/// user (a fingerprint, never the token), so a call is made only when the
/// two differ: a rotated token, a sign-out, a sign-in with a new token.
/// The exchange sends the token too; the first run after it may repeat it
/// once, which is harmless.
class PushRegistration {
  PushRegistration({
    required PosApiClient client,
    required PosDatabase db,
    required PosPushConfig push,
    DateTime Function() clock = DateTime.now,
  }) : _client = client,
       _db = db,
       _push = push,
       _clock = clock;

  final PosApiClient _client;
  final PosDatabase _db;
  final PosPushConfig _push;
  final DateTime Function() _clock;
  Future<void>? _running;

  /// Sends what changed, if anything. One run at a time. Throws when the
  /// POS API can't be reached; the next run tries again.
  Future<void> reconcile() => _running ??= _reconcile().whenComplete(() {
    _running = null;
  });

  Future<void> _reconcile() async {
    final session = (await _client.vault.read()).active;
    if (session == null) return;
    final userId = session.user.id;
    String? token;
    if (session.uiAccess) {
      try {
        token = await _push.getToken();
      } on Object catch (e) {
        // Not the same as "no token": leave the registration as it is.
        _log.info('the host push token is unavailable (${e.runtimeType})');
        return;
      }
      if (token != null && token.isEmpty) token = null;
    }
    final wanted = token == null
        ? _none
        : sha256Hex('${_push.provider}\n$token');
    final key = 'push.registered.$userId';
    if (await _state(key) == wanted) return;
    await _client.updateDevice(
      token == null
          ? const {'push_token': null}
          : {'push_provider': _push.provider, 'push_token': token},
      userId: userId,
    );
    await _setState(key, wanted);
    _log.info(token == null ? 'push unregistered' : 'push token registered');
  }

  Future<String?> _state(String key) async => (await (_db.select(
    _db.syncState,
  )..where((s) => s.key.equals(key))).getSingleOrNull())?.value;

  Future<void> _setState(String key, String value) => _db
      .into(_db.syncState)
      .insertOnConflictUpdate(
        SyncStateCompanion.insert(
          key: key,
          value: value,
          updatedAt: isoWithOffset(_clock()),
        ),
      );
}
