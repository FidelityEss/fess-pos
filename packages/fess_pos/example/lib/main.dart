import 'package:fess_pos/fess_pos.dart';
import 'package:flutter/material.dart';

/// The harness host: it starts the module and signs in the way a real host
/// does (docs/03 §3), with QA's stand-in identity issuer in place of FESS.
///
///     # a QA host token for a QA agent, valid 24 h
///     # (tools/scenarios/module-harness.ts, from fess-pos/)
///     flutter run --dart-define-from-file=$HOME/.fess-pos/module-harness-qa.json
///
/// No endpoint, key or token is compiled into the module (docs/03 §9). The
/// defines stand in for a host's build flavour and its signed-in user.
/// Without them the module starts against an address that doesn't exist and
/// signing in is off.
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

/// The host's signed-in user, from the defines; null without a host token.
PosIdentity? harnessIdentity() {
  const token = String.fromEnvironment('POS_HOST_TOKEN');
  if (token.isEmpty) return null;
  const issuedAt = String.fromEnvironment('POS_HOST_TOKEN_ISSUED_AT');
  return PosIdentity(
    profile: PosUserProfile(
      employeeNumber: const String.fromEnvironment(
        'POS_EMPLOYEE_NUMBER',
        defaultValue: 'unknown',
      ),
      firstName: 'Harness',
      lastName: 'Agent',
    ),
    getIdentityToken: () async => PosIdentityToken(
      token: token,
      issuer: const String.fromEnvironment(
        'POS_HOST_ISSUER',
        defaultValue: 'pos_dev',
      ),
      issuedAt: DateTime.tryParse(issuedAt),
    ),
  );
}

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
  final PosIdentity? _identity = harnessIdentity();
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

  @override
  Widget build(BuildContext context) {
    final info = PosModule.info;
    final startError = widget.startError;
    final identity = _identity;
    final canAct = !_busy && startError == null;
    return Scaffold(
      appBar: AppBar(title: const Text('Harness host')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(
            'fess_pos ${info.moduleVersion} · API v${info.apiVersion} · '
            'spec ${info.specVersion}',
          ),
          if (startError != null) Text('initialize failed: ${startError.code}'),
          Text('access: ${_access?.reason.name ?? '…'}'),
          if (_lastError != null) Text('last error: $_lastError'),
          if (identity == null)
            const Text('No host token: signing in is off (see main.dart).')
          else
            Text('host user: ${identity.profile.employeeNumber}'),
          const SizedBox(height: 16),
          ElevatedButton(
            onPressed: canAct && identity != null
                ? () => _run(() => PosModule.signIn(identity))
                : null,
            child: const Text('Sign in'),
          ),
          ElevatedButton(
            onPressed: canAct ? () => _run(PosModule.signOut) : null,
            child: const Text('Sign out'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute<void>(builder: (_) => PosModule.entryPoint()),
            ),
            child: const Text('Open POS'),
          ),
        ],
      ),
    );
  }
}
