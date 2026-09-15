import 'package:fess_pos/src/contract/capabilities.dart';
import 'package:fess_pos/src/contract/errors.dart';
import 'package:fess_pos/src/contract/host_config.dart';
import 'package:fess_pos/src/contract/identity.dart';
import 'package:fess_pos/src/core/logging/pos_logger.dart';
import 'package:fess_pos/src/core/time/device_time.dart';
import 'package:fess_pos/src/core/version.dart';
import 'package:fess_pos/src/data/remote/pos_api_client.dart';
import 'package:fess_pos/src/data/remote/retry_policy.dart';
import 'package:fess_pos/src/data/remote/session_vault.dart';
import 'package:fess_pos/src/domain/session/session_gateway.dart';
import 'package:fess_pos/src/platform/device_info.dart';

const PosLogger _log = PosLogger('session');

/// Signing in, as the module does it (docs/03 §3, docs/07 §2): there is no
/// sign-in screen. The host hands over the identity it already holds, and
/// the module exchanges the host's token for its own POS session.
///
/// - **Online**, every sign-in runs the exchange, so the POS API re-checks
///   the host token each time.
/// - **Offline**, the same user's stored session is used when it hasn't
///   expired, so an agent can work without signal. The next sign-in online
///   runs the exchange again.
/// - **Refused** (the host token isn't valid any more, the user is
///   inactive): that user's stored session loses UI access, and is signed
///   out on the server, so queued work still uploads (`ingest_only`).
class ApiSessionGateway implements SessionGateway {
  ApiSessionGateway({
    required this.client,
    required DeviceInfoProvider deviceInfo,
    PosPushConfig? push,
    DateTime Function()? clock,
  }) : _deviceInfo = deviceInfo,
       _push = push,
       _clock = clock ?? DateTime.now;

  final PosApiClient client;
  final DeviceInfoProvider _deviceInfo;
  final PosPushConfig? _push;
  final DateTime Function() _clock;

  /// The identity from the last sign-in in this process, for re-verifying.
  PosIdentity? _lastIdentity;

  @override
  Future<void> reverifyIfDue(Duration every) async {
    final identity = _lastIdentity;
    final session = client.vault.cached?.active;
    if (identity == null || session == null || !session.usable) return;
    if (_clock().difference(session.verifiedAt) < every) return;
    try {
      await exchange(identity);
    } on Object catch (e) {
      final code = e is PosException ? e.code : e.runtimeType.toString();
      _log.info('re-verification not done ($code); tried again later');
    }
  }

  @override
  PosSessionInfo? get current {
    final session = client.vault.cached?.active;
    if (session == null || !session.usable) return null;
    return PosSessionInfo(scope: session.scope, uiAccess: session.uiAccess);
  }

  @override
  Future<PosSessionInfo> exchange(PosIdentity identity) async {
    _lastIdentity = identity;
    final PosIdentityToken token;
    try {
      token = await identity.getIdentityToken();
    } on Object catch (e) {
      throw PosException(
        PosErrorCodes.hostTokenUnavailable,
        "the host's getIdentityToken failed",
        kind: PosErrorKind.auth,
        retryable: true,
        cause: e,
      );
    }
    final request = exchangeRequestBody(
      token: token,
      deviceId: await client.vault.deviceId(),
      device: await _describe(),
      profile: identity.profile,
      push: await _pushRegistration(),
    );
    try {
      final session = await client.exchange(request, issuer: token.issuer);
      await client.sendPendingSignOuts(except: session.user.id);
      _log.info('signed in (${session.scope.name})');
      return PosSessionInfo(scope: session.scope, uiAccess: session.uiAccess);
    } on PosException catch (e) {
      final stored = _storedFor(await client.vault.read(), identity.profile);
      if (classifyFailure(e) == FailureAction.retry &&
          stored != null &&
          stored.refreshExpiresAt.isAfter(_clock())) {
        final userId = stored.user.id;
        final book = await client.vault.update((book) {
          final latest = book.sessions[userId] ?? stored;
          return book
              .put(
                latest.copyWith(
                  uiAccess: latest.scope == PosSessionScope.full,
                  signOutPending: false,
                ),
              )
              .activate(userId);
        });
        final resumed = book.sessions[userId]!;
        _log.info('offline (${e.code}): signed in with the stored session');
        return PosSessionInfo(
          scope: resumed.scope,
          uiAccess: resumed.uiAccess,
          offline: true,
        );
      }
      if (identityRefusedCodes.contains(e.code) && stored != null) {
        _log.warning('the POS API refused the host identity (${e.code})');
        await client.endUiAccess(stored.user.id);
      }
      rethrow;
    }
  }

  @override
  Future<void> endUiAccess() async {
    final userId = (await client.vault.read()).activeUserId;
    if (userId != null) await client.endUiAccess(userId);
  }

  /// The usable stored session whose verified employee number matches the
  /// host's profile, the current user's first. The profile only narrows
  /// the choice: the session itself was issued to this device after the
  /// POS API verified the host token.
  StoredSession? _storedFor(SessionBook book, PosUserProfile profile) {
    final wanted = _normalise(profile.employeeNumber);
    final candidates = [
      ?book.active,
      ...book.sessions.values.where((s) => s.user.id != book.activeUserId),
    ];
    for (final s in candidates) {
      if (s.usable && _normalise(s.user.employeeNumber) == wanted) return s;
    }
    return null;
  }

  Future<DeviceDescription?> _describe() async {
    try {
      return await _deviceInfo.describe();
    } on Object catch (e) {
      _log.info('device details unavailable (${e.runtimeType})');
      return null;
    }
  }

  Future<(String, String)?> _pushRegistration() async {
    final push = _push;
    if (push == null) return null;
    try {
      final token = await push.getToken();
      if (token == null || token.isEmpty) return null;
      return (push.provider, token);
    } on Object catch (e) {
      _log.info('no push token from the host (${e.runtimeType})');
      return null;
    }
  }

  static String _normalise(String employeeNumber) =>
      employeeNumber.trim().toUpperCase();
}

/// The `POST /v1/auth/exchange` body
/// (`schema/api/auth-exchange-request.schema.json`).
///
/// Device and profile details are for display and audit only, so a value
/// longer than the API allows is left out rather than cut short or allowed
/// to fail the sign-in.
Map<String, Object?> exchangeRequestBody({
  required PosIdentityToken token,
  required String deviceId,
  required DeviceDescription? device,
  required PosUserProfile profile,
  (String, String)? push,
}) {
  String? fit(String? value, int max) =>
      value == null || value.isEmpty || value.length > max ? null : value;
  final clientType = device?.clientType ?? 'native';
  final issuedAt = token.issuedAt;
  final secondary = fit(token.secondaryToken, 16384);
  final pushProvider = fit(push?.$1, 40);
  final pushToken = fit(push?.$2, 4096);
  final extra = {
    for (final e in profile.extra.entries)
      if (e.value.length <= 2000) e.key: e.value,
  };
  final body = <String, Object?>{
    'issuer': token.issuer,
    'token': token.token,
    'issued_at': ?issuedAt == null ? null : isoWithOffset(issuedAt),
    'secondary_token': ?secondary,
    'device': {
      'device_id': deviceId,
      'client_type': clientType,
      'platform': ?fit(device?.os, 40),
      'model': ?fit(device?.model, 120),
      'os_version': ?fit(device?.osVersion, 60),
      'host_app_version': ?fit(device?.hostAppVersion, 60),
      'module_version': PosVersions.module,
      'capabilities': capabilityReport(clientType, device?.os),
      if (pushProvider != null && pushToken != null) ...{
        'push_provider': pushProvider,
        'push_token': pushToken,
      },
    },
    'profile': {
      'employee_number': ?fit(profile.employeeNumber, 32),
      'first_name': ?fit(profile.firstName, 120),
      'last_name': ?fit(profile.lastName, 120),
      'email': ?fit(profile.email, 320),
      'phone': ?fit(profile.phone, 40),
      'photo_url': ?fit(profile.photoUrl, 2048),
      if (extra.isNotEmpty) 'extra': extra,
    },
  };
  return body;
}

/// What this build of the module supports (docs/04 §8): its versions, and
/// the form components, view components, flow steps and page types it can
/// show, each with its version.
Map<String, Object?> capabilityReport(String clientType, String? platform) => {
  'module_version': PosVersions.module,
  'api_versions': [PosVersions.api],
  'spec_versions': [PosVersions.spec],
  'client_type': clientType,
  if (platform != null && platform.length <= 40) 'platform': platform,
  'components': supportedFormComponents,
  'view_components': supportedViewComponents,
  'flow_steps': supportedFlowSteps,
  'page_types': supportedPageTypes,
};
