import 'dart:async';
import 'dart:convert';

import 'package:fess_pos/src/contract/errors.dart';
import 'package:fess_pos/src/core/logging/pos_logger.dart';
import 'package:fess_pos/src/domain/session/session_gateway.dart';
import 'package:fess_pos/src/platform/secure_store.dart';
import 'package:meta/meta.dart';
import 'package:uuid/uuid.dart';

const PosLogger _log = PosLogger('session');

/// The POS user a session belongs to, as the POS API verified them.
@immutable
class SessionUser {
  const SessionUser({
    required this.id,
    required this.employeeNumber,
    required this.firstName,
    required this.lastName,
    required this.role,
    required this.active,
  });

  factory SessionUser.fromJson(Object? json) {
    if (json is! Map<String, Object?>) {
      throw const FormatException('user is not an object');
    }
    return SessionUser(
      id: _text(json, 'id'),
      employeeNumber: _text(json, 'employee_number'),
      firstName: _text(json, 'first_name'),
      lastName: _text(json, 'last_name'),
      role: _text(json, 'role'),
      active: json['active'] == true,
    );
  }

  final String id;
  final String employeeNumber;
  final String firstName;
  final String lastName;
  final String role;
  final bool active;

  Map<String, Object?> toJson() => {
    'id': id,
    'employee_number': employeeNumber,
    'first_name': firstName,
    'last_name': lastName,
    'role': role,
    'active': active,
  };

  /// Content-free: names and employee numbers are personal data.
  @override
  String toString() => 'SessionUser($id)';
}

/// A POS session as the device keeps it in secure storage (docs/07 §2): a
/// short-lived access token and the rotating, device-bound refresh token.
///
/// Expiry times are on the device clock. The server's lifetimes are counted
/// from its own `server_time`, so a phone whose clock is wrong still
/// refreshes at the right moment.
@immutable
class StoredSession {
  const StoredSession({
    required this.sessionId,
    required this.scope,
    required this.accessToken,
    required this.accessExpiresAt,
    required this.refreshToken,
    required this.refreshExpiresAt,
    required this.user,
    required this.issuer,
    required this.verifiedAt,
    required this.uiAccess,
    this.signOutPending = false,
    this.endedBy,
  });

  /// From an exchange or refresh answer
  /// (`schema/api/auth-exchange-response.schema.json`). UI access needs a
  /// `full` session.
  factory StoredSession.fromTokens(
    Map<String, Object?> body, {
    required String issuer,
    required DateTime receivedAt,
    required DateTime verifiedAt,
    bool uiAccess = true,
    bool signOutPending = false,
  }) {
    try {
      final serverTime = DateTime.parse(_text(body, 'server_time'));
      DateTime onDeviceClock(String key) => receivedAt.add(
        DateTime.parse(_text(body, key)).difference(serverTime),
      );
      final scope = _scope(body['scope']);
      return StoredSession(
        sessionId: _text(body, 'session_id'),
        scope: scope,
        accessToken: _text(body, 'access_token'),
        accessExpiresAt: onDeviceClock('access_expires_at'),
        refreshToken: _text(body, 'refresh_token'),
        refreshExpiresAt: onDeviceClock('refresh_expires_at'),
        user: SessionUser.fromJson(body['user']),
        issuer: issuer,
        verifiedAt: verifiedAt,
        uiAccess: uiAccess && scope == PosSessionScope.full,
        signOutPending: signOutPending,
      );
    } on FormatException catch (e) {
      throw PosException(
        PosErrorCodes.responseMalformed,
        'the session answer is incomplete: ${e.message}',
        kind: PosErrorKind.server,
        retryable: true,
        cause: e,
      );
    }
  }

  factory StoredSession.fromJson(Map<String, Object?> json) => StoredSession(
    sessionId: _text(json, 'session_id'),
    scope: _scope(json['scope']),
    accessToken: _text(json, 'access_token'),
    accessExpiresAt: DateTime.parse(_text(json, 'access_expires_at')),
    refreshToken: _text(json, 'refresh_token'),
    refreshExpiresAt: DateTime.parse(_text(json, 'refresh_expires_at')),
    user: SessionUser.fromJson(json['user']),
    issuer: _text(json, 'issuer'),
    verifiedAt: DateTime.parse(_text(json, 'verified_at')),
    uiAccess: json['ui_access'] == true,
    signOutPending: json['sign_out_pending'] == true,
    endedBy: json['ended_by'] is String ? json['ended_by']! as String : null,
  );

  final String sessionId;
  final PosSessionScope scope;
  final String accessToken;
  final DateTime accessExpiresAt;
  final String refreshToken;
  final DateTime refreshExpiresAt;
  final SessionUser user;

  /// The host issuer the session was exchanged from, e.g. `fess_auth_api`.
  final String issuer;

  /// When the host's identity was last verified by an exchange.
  final DateTime verifiedAt;

  /// Whether this session may show the POS UI (docs/03 §3).
  final bool uiAccess;

  /// A sign-out the server hasn't confirmed yet; sent before the next call.
  final bool signOutPending;

  /// The code that ended this session for good, or null while it is usable.
  /// An ended session is kept: its user's queued work still needs it
  /// replaced, never discarded.
  final String? endedBy;

  bool get usable => endedBy == null;

  /// The access token is good for at least [margin] more.
  bool accessValidAt(DateTime now, Duration margin) =>
      accessExpiresAt.isAfter(now.add(margin));

  /// The session after a refresh: new tokens, the same user and flags.
  StoredSession rotated(
    Map<String, Object?> body, {
    required DateTime receivedAt,
  }) => StoredSession.fromTokens(
    body,
    issuer: issuer,
    receivedAt: receivedAt,
    verifiedAt: verifiedAt,
    uiAccess: uiAccess,
    signOutPending: signOutPending,
  );

  StoredSession copyWith({
    PosSessionScope? scope,
    bool? uiAccess,
    bool? signOutPending,
  }) => StoredSession(
    sessionId: sessionId,
    scope: scope ?? this.scope,
    accessToken: accessToken,
    accessExpiresAt: accessExpiresAt,
    refreshToken: refreshToken,
    refreshExpiresAt: refreshExpiresAt,
    user: user,
    issuer: issuer,
    verifiedAt: verifiedAt,
    uiAccess: uiAccess ?? this.uiAccess,
    signOutPending: signOutPending ?? this.signOutPending,
    endedBy: endedBy,
  );

  /// This session can't be used again.
  StoredSession ended(String code) => StoredSession(
    sessionId: sessionId,
    scope: scope,
    accessToken: accessToken,
    accessExpiresAt: accessExpiresAt,
    refreshToken: refreshToken,
    refreshExpiresAt: refreshExpiresAt,
    user: user,
    issuer: issuer,
    verifiedAt: verifiedAt,
    uiAccess: false,
    endedBy: code,
  );

  Map<String, Object?> toJson() => {
    'session_id': sessionId,
    'scope': scope == PosSessionScope.full ? 'full' : 'ingest_only',
    'access_token': accessToken,
    'access_expires_at': accessExpiresAt.toUtc().toIso8601String(),
    'refresh_token': refreshToken,
    'refresh_expires_at': refreshExpiresAt.toUtc().toIso8601String(),
    'user': user.toJson(),
    'issuer': issuer,
    'verified_at': verifiedAt.toUtc().toIso8601String(),
    'ui_access': uiAccess,
    'sign_out_pending': signOutPending,
    'ended_by': endedBy,
  };

  /// Never prints a token.
  @override
  String toString() =>
      'StoredSession($sessionId, ${scope.name}, ui: $uiAccess, '
      'ended: ${endedBy ?? '-'})';
}

/// Every POS session on this device, one per user, and whose is current.
///
/// A previous user's session stays after another user signs in: work that
/// user captured still uploads under their own session (docs/12 §15).
@immutable
class SessionBook {
  const SessionBook({this.activeUserId, this.sessions = const {}});

  /// Reads what [toStorage] wrote. Unreadable entries are skipped and
  /// logged; the tokens in them can be replaced by signing in again.
  factory SessionBook.fromStorage(String? text) {
    if (text == null) return empty;
    final Object? decoded;
    try {
      decoded = jsonDecode(text);
    } on FormatException {
      _log.warning('stored sessions are not JSON; starting with none');
      return empty;
    }
    if (decoded is! Map<String, Object?>) return empty;
    final sessions = <String, StoredSession>{};
    final raw = decoded['sessions'];
    if (raw is Map<String, Object?>) {
      for (final entry in raw.entries) {
        final value = entry.value;
        if (value is! Map<String, Object?>) continue;
        try {
          sessions[entry.key] = StoredSession.fromJson(value);
        } on Object {
          _log.warning('a stored session is unreadable; skipped');
        }
      }
    }
    final active = decoded['active'];
    return SessionBook(
      activeUserId: active is String && sessions.containsKey(active)
          ? active
          : null,
      sessions: Map.unmodifiable(sessions),
    );
  }

  static const SessionBook empty = SessionBook();

  final String? activeUserId;
  final Map<String, StoredSession> sessions;

  StoredSession? get active =>
      activeUserId == null ? null : sessions[activeUserId];

  SessionBook put(StoredSession session) => SessionBook(
    activeUserId: activeUserId,
    sessions: Map.unmodifiable({...sessions, session.user.id: session}),
  );

  SessionBook activate(String userId) =>
      SessionBook(activeUserId: userId, sessions: sessions);

  String toStorage() => jsonEncode({
    'active': activeUserId,
    'sessions': {
      for (final e in sessions.entries) e.key: e.value.toJson(),
    },
  });
}

/// Keeps the device id and the POS sessions in the module's secure storage
/// (Keychain readable after first unlock and never moved to another device;
/// Android's encrypted preferences), with a copy in memory.
class SessionVault {
  SessionVault(this._store, {String Function()? newDeviceId})
    : _newDeviceId = newDeviceId ?? const Uuid().v4;

  static const String deviceIdKey = 'device_id.v1';
  static const String sessionsKey = 'sessions.v1';

  static final RegExp _uuid = RegExp(
    r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
  );

  final SecureStore _store;
  final String Function() _newDeviceId;
  String? _deviceId;
  SessionBook? _book;
  Future<void> _queue = Future.value();

  /// The sessions as last read or written, without waiting.
  SessionBook? get cached => _book;

  /// This installation's device id (docs/07 §2): created once, then kept.
  /// A store that can't be read right now fails instead of minting a new
  /// id, so the device isn't registered twice.
  Future<String> deviceId() async {
    final known = _deviceId;
    if (known != null) return known;
    final stored = await _read(deviceIdKey);
    if (stored != null && _uuid.hasMatch(stored)) return _deviceId = stored;
    final created = _newDeviceId();
    await _write(deviceIdKey, created);
    if (await _read(deviceIdKey) != created) {
      throw const PosException(
        PosErrorCodes.secureStoreUnavailable,
        'the device id could not be stored',
        kind: PosErrorKind.localStore,
        retryable: true,
      );
    }
    _log.info('device id created');
    return _deviceId = created;
  }

  Future<SessionBook> read() async =>
      _book ??= SessionBook.fromStorage(await _read(sessionsKey));

  /// Applies [change] to the sessions and stores the result. Changes run
  /// one at a time. The new book is used even if storing it fails (logged):
  /// a refreshed token that isn't used would end the session.
  Future<SessionBook> update(SessionBook Function(SessionBook book) change) {
    final done = _queue.then((_) async {
      final next = change(await read());
      _book = next;
      try {
        await _store.write(sessionsKey, next.toStorage());
      } on Object catch (e, st) {
        _log.error(
          'sessions could not be stored; kept in memory',
          error: e,
          stackTrace: st,
        );
      }
      return next;
    });
    _queue = done.then<void>((_) {}, onError: (Object _) {});
    return done;
  }

  Future<String?> _read(String key) async {
    try {
      return await _store.read(key);
    } on Object catch (e) {
      throw PosException(
        PosErrorCodes.secureStoreUnavailable,
        'secure storage could not be read',
        kind: PosErrorKind.localStore,
        retryable: true,
        cause: e,
      );
    }
  }

  Future<void> _write(String key, String value) async {
    try {
      await _store.write(key, value);
    } on Object catch (e) {
      throw PosException(
        PosErrorCodes.secureStoreUnavailable,
        'secure storage could not be written',
        kind: PosErrorKind.localStore,
        retryable: true,
        cause: e,
      );
    }
  }
}

String _text(Map<String, Object?> json, String key) {
  final v = json[key];
  if (v is String && v.isNotEmpty) return v;
  throw FormatException('$key is missing');
}

PosSessionScope _scope(Object? v) => switch (v) {
  'full' => PosSessionScope.full,
  'ingest_only' => PosSessionScope.ingestOnly,
  _ => throw FormatException('scope $v is not full or ingest_only'),
};
