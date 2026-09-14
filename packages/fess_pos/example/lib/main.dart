import 'dart:convert';

import 'package:fess_pos/fess_pos.dart';
import 'package:flutter/material.dart';

/// The harness host: it starts the module and signs in the way a real host
/// does (docs/03 §3), with QA's stand-in identity issuer in place of FESS.
/// Its home page is a simulated FESS login: pick a QA agent, log in, and
/// POS opens, on an emulator or on your own phone.
///
///     # logins for QA agents, valid 24 h
///     # (tools/scenarios/module-harness.ts, from fess-pos/)
///     flutter run --dart-define-from-file=$HOME/.fess-pos/module-harness-qa.json
///
/// No endpoint, key or token is compiled into the module (docs/03 §9). The
/// defines stand in for a host's build flavour and its signed-in user.
/// Without them the module starts against an address that doesn't exist and
/// logging in is off.
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  PosException? startError;
  try {
    await PosModule.initialize(PosHostConfig(bootstrap: harnessBootstrap()));
  } on PosException catch (e) {
    startError = e;
  }
  runApp(HarnessApp(startError: startError));
}

PosBootstrap harnessBootstrap() => PosBootstrap(
  apiBaseUrl: Uri.parse(
    const String.fromEnvironment(
      'POS_API_URL',
      defaultValue: 'https://pos.example.invalid/functions/v1/api',
    ),
  ),
  publishableKey: const String.fromEnvironment(
    'POS_PUBLISHABLE_KEY',
    defaultValue: 'sb_publishable_harness',
  ),
  environment: const String.fromEnvironment('POS_ENVIRONMENT') == 'qa'
      ? PosEnvironment.qa
      : PosEnvironment.dev,
);

/// A simulated FESS login for one QA agent: the host token FESS would hold
/// for them. It is minted on the Mac by `tools/scenarios/module-harness.ts`
/// from the QA seed admin, whose credentials never reach the phone.
@immutable
class HarnessLogin {
  const HarnessLogin({
    required this.employeeNumber,
    required this.token,
    this.issuedAt,
  });

  final String employeeNumber;
  final String token;
  final DateTime? issuedAt;

  /// How long the stand-in issuer's host tokens last.
  static const Duration validFor = Duration(hours: 24);

  DateTime? get expiresAt => issuedAt?.add(validFor);

  bool expiredAt(DateTime now) {
    final end = expiresAt;
    return end != null && !now.isBefore(end);
  }

  PosIdentity identity() => PosIdentity(
    profile: PosUserProfile(
      employeeNumber: employeeNumber,
      firstName: 'Harness',
      lastName: 'Agent',
    ),
    getIdentityToken: () async => PosIdentityToken(
      token: token,
      issuer: const String.fromEnvironment(
        'POS_HOST_ISSUER',
        defaultValue: 'pos_dev',
      ),
      issuedAt: issuedAt,
    ),
  );
}

HarnessLogin? _login(Object? json) {
  if (json is! Map<String, Object?>) return null;
  final number = json['employee_number'];
  final token = json['token'];
  final at = json['issued_at'];
  if (number is! String || token is! String || token.isEmpty) return null;
  return HarnessLogin(
    employeeNumber: number,
    token: token,
    issuedAt: at is String ? DateTime.tryParse(at) : null,
  );
}

/// The logins this build holds: `POS_HOST_LOGINS` (one per agent, from
/// `module-harness.ts EMPLOYEE_NUMBER…`), else the single `POS_HOST_TOKEN`.
List<HarnessLogin> harnessLogins({
  String logins = const String.fromEnvironment('POS_HOST_LOGINS'),
  String token = const String.fromEnvironment('POS_HOST_TOKEN'),
  String employeeNumber = const String.fromEnvironment(
    'POS_EMPLOYEE_NUMBER',
    defaultValue: 'unknown',
  ),
  String issuedAt = const String.fromEnvironment('POS_HOST_TOKEN_ISSUED_AT'),
}) {
  if (logins.isNotEmpty) {
    try {
      final decoded = jsonDecode(logins);
      final found = [
        if (decoded is List<Object?>)
          for (final l in decoded) ?_login(l),
      ];
      if (found.isNotEmpty) return found;
    } on FormatException {
      // Fall back to the single login.
    }
  }
  if (token.isEmpty) return const [];
  return [
    HarnessLogin(
      employeeNumber: employeeNumber,
      token: token,
      issuedAt: DateTime.tryParse(issuedAt),
    ),
  ];
}

/// The host's signed-in user for the device tests: the first login.
PosIdentity? harnessIdentity() => harnessLogins().firstOrNull?.identity();

class HarnessApp extends StatelessWidget {
  const HarnessApp({this.startError, super.key});

  final PosException? startError;

  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'fess_pos harness',
    home: HarnessHome(startError: startError),
  );
}

class HarnessHome extends StatefulWidget {
  const HarnessHome({this.startError, super.key});

  final PosException? startError;

  @override
  State<HarnessHome> createState() => _HarnessHomeState();
}

class _HarnessHomeState extends State<HarnessHome> {
  final List<HarnessLogin> _logins = harnessLogins();
  late HarnessLogin? _chosen = _logins.firstOrNull;
  String? _loggedInAs;
  PosAccess? _access;
  String? _lastError;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    final access = await PosModule.access();
    if (mounted) setState(() => _access = access);
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() {
      _busy = true;
      _lastError = null;
    });
    try {
      await action();
    } on PosException catch (e) {
      _lastError = '${e.code} (retryable: ${e.retryable})';
    }
    _busy = false;
    await _refresh();
  }

  /// What a FESS login does for POS: signs in with the user's identity,
  /// then opens the entry point.
  Future<void> _logIn(HarnessLogin login) => _run(() async {
    final access = await PosModule.signIn(login.identity());
    _loggedInAs = login.employeeNumber;
    if (access.visible && mounted) _openPos();
  });

  Future<void> _logOut() => _run(() async {
    await PosModule.signOut();
    _loggedInAs = null;
  });

  void _openPos() => Navigator.of(
    context,
  ).push(MaterialPageRoute<void>(builder: (_) => PosModule.entryPoint()));

  static String _when(DateTime t) {
    String two(int n) => n.toString().padLeft(2, '0');
    final l = t.toLocal();
    return '${l.day}/${l.month} ${two(l.hour)}:${two(l.minute)}';
  }

  Widget _login(BuildContext context, {required bool loggedIn}) {
    final chosen = _chosen;
    if (chosen == null) {
      return const Text(
        'No logins in this build. On the Mac, mint them with '
        'tools/scenarios/module-harness.ts, then build with '
        '--dart-define-from-file (see the README).',
      );
    }
    final expiresAt = chosen.expiresAt;
    final expired = chosen.expiredAt(DateTime.now());
    final canAct = !_busy && widget.startError == null;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_logins.length > 1)
          DropdownButton<HarnessLogin>(
            key: const ValueKey('harness-agent'),
            value: chosen,
            isExpanded: true,
            items: [
              for (final l in _logins)
                DropdownMenuItem(value: l, child: Text(l.employeeNumber)),
            ],
            onChanged: loggedIn || _busy
                ? null
                : (l) => setState(() => _chosen = l),
          )
        else
          Text('Agent: ${chosen.employeeNumber}'),
        if (expiresAt != null)
          Text(
            expired
                ? 'This login expired at ${_when(expiresAt)}. Mint a new one '
                      'on the Mac and install the app again.'
                : 'Login valid until ${_when(expiresAt)}',
            style: TextStyle(
              color: expired ? Theme.of(context).colorScheme.error : null,
            ),
          ),
        const SizedBox(height: 12),
        if (!loggedIn)
          FilledButton(
            key: const ValueKey('harness-login'),
            onPressed: canAct && !expired ? () => _logIn(chosen) : null,
            child: Text('Log in as ${chosen.employeeNumber}'),
          )
        else ...[
          Text(
            _loggedInAs == null
                ? 'Logged in to POS'
                : 'Logged in to POS as $_loggedInAs',
          ),
          const SizedBox(height: 8),
          FilledButton(
            key: const ValueKey('harness-open-pos'),
            onPressed: _openPos,
            child: const Text('Open POS'),
          ),
          OutlinedButton(
            key: const ValueKey('harness-logout'),
            onPressed: canAct ? _logOut : null,
            child: const Text('Log out'),
          ),
        ],
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final info = PosModule.info;
    final startError = widget.startError;
    final loggedIn = _access?.visible ?? false;
    return Scaffold(
      appBar: AppBar(title: const Text('FESS (harness)')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(
            'Simulated FESS login',
            style: Theme.of(context).textTheme.titleLarge,
          ),
          const SizedBox(height: 8),
          _login(context, loggedIn: loggedIn),
          const Divider(height: 32),
          Text(
            'fess_pos ${info.moduleVersion} · API v${info.apiVersion} · '
            'spec ${info.specVersion}',
          ),
          if (startError != null) Text('initialize failed: ${startError.code}'),
          Text('access: ${_access?.reason.name ?? '…'}'),
          if (_lastError != null) Text('last error: $_lastError'),
          if (!loggedIn)
            // The module says why it can't show POS yet.
            TextButton(onPressed: _openPos, child: const Text('Open POS')),
        ],
      ),
    );
  }
}
