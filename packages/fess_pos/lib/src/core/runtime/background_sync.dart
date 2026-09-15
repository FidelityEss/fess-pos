import 'dart:async';
import 'dart:convert';

import 'package:fess_pos/src/contract/bootstrap.dart';
import 'package:fess_pos/src/contract/host_config.dart';
import 'package:fess_pos/src/core/logging/pos_logger.dart';
import 'package:fess_pos/src/core/runtime/module_runtime.dart';
import 'package:fess_pos/src/platform/background_work.dart';
import 'package:fess_pos/src/platform/secure_store.dart';

const PosLogger _log = PosLogger('background');

/// Secure-store key of the bootstrap a background run starts from (T5-01,
/// D-94). iOS periodic tasks carry no input, so it can't travel with the
/// task. Nothing in it is secret: the publishable key is public.
const String backgroundBootstrapKey = 'background_bootstrap.v1';

Future<void> saveBackgroundBootstrap(
  SecureStore store,
  PosBootstrap bootstrap,
) => store.write(
  backgroundBootstrapKey,
  jsonEncode({
    'api_base_url': '${bootstrap.apiBaseUrl}',
    'publishable_key': bootstrap.publishableKey,
    'environment': bootstrap.environment.name,
  }),
);

/// The saved bootstrap; null when none was saved or it can't be read.
Future<PosBootstrap?> readBackgroundBootstrap(SecureStore store) async {
  final text = await store.read(backgroundBootstrapKey);
  if (text == null) return null;
  try {
    final json = jsonDecode(text) as Map<String, Object?>;
    return PosBootstrap(
      apiBaseUrl: Uri.parse(json['api_base_url']! as String),
      publishableKey: json['publishable_key']! as String,
      environment: PosEnvironment.values.byName(
        json['environment']! as String,
      ),
    );
  } on Object {
    return null;
  }
}

/// What the platform starts in the background (D-36): runs each task the
/// module scheduled.
@pragma('vm:entry-point')
void posBackgroundDispatcher() => runBackgroundTasks(runBackgroundTask);

/// One background task: starts the module from the saved bootstrap, sends
/// what is queued and uploads what is waiting. Pulls wait for the app,
/// because they need the host's sign-in (docs/08 §7).
///
/// Says whether the task is done. The periodic sync always is: it comes
/// round again. A sync on leaving is done once nothing is left to send;
/// otherwise the platform tries it again later.
Future<bool> runBackgroundTask(
  String task, {
  ModuleDependencies Function(PosHostConfig config)? dependencies,
  SecureStore? store,
}) async {
  try {
    final bootstrap = await readBackgroundBootstrap(
      store ?? FlutterSecureStore(),
    );
    if (bootstrap == null) {
      _log.warning('no saved bootstrap: background sync skipped');
      return true;
    }
    final config = PosHostConfig(bootstrap: bootstrap);
    final runtime = await ModuleRuntime.start(
      config,
      dependencies: dependencies?.call(config),
    );
    await runtime.runSync(keepRunning: false);
    if (task == BackgroundTasks.periodicSync) return true;
    return await runtime.pendingWork() == 0;
  } on Object catch (e, st) {
    _log.warning('background sync failed', error: e, stackTrace: st);
    return false;
  }
}
