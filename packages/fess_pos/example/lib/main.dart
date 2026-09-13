import 'package:fess_pos/fess_pos.dart';
import 'package:flutter/material.dart';

/// The harness host: it starts the module the way a real host does and
/// opens its entry point. The stand-in identity issuer arrives with T1-24.
///
///     flutter run \
///       --dart-define=POS_API_URL=https://<ref>.supabase.co/functions/v1/api \
///       --dart-define=POS_PUBLISHABLE_KEY=sb_publishable_…
///
/// No endpoint or key is compiled in (docs/03 §9). Without the defines the
/// module starts against an address that doesn't exist.
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
  environment: PosEnvironment.dev,
);

class HarnessApp extends StatelessWidget {
  const HarnessApp({this.startError, super.key});

  final PosException? startError;

  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'fess_pos harness',
    home: HarnessHome(startError: startError),
  );
}

class HarnessHome extends StatelessWidget {
  const HarnessHome({this.startError, super.key});

  final PosException? startError;

  @override
  Widget build(BuildContext context) {
    final info = PosModule.info;
    final error = startError;
    return Scaffold(
      appBar: AppBar(title: const Text('Harness host')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(
            'fess_pos ${info.moduleVersion} · API v${info.apiVersion} · '
            'spec ${info.specVersion}',
          ),
          if (error != null) Text('initialize failed: ${error.code}'),
          FutureBuilder<PosAccess>(
            future: PosModule.access(),
            builder: (context, snapshot) =>
                Text('access: ${snapshot.data?.reason.name ?? '…'}'),
          ),
          const SizedBox(height: 16),
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
