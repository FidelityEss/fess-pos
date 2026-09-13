import 'package:fess_pos/src/contract/events.dart';
import 'package:fess_pos/src/core/content/bundled_copy.dart';
import 'package:fess_pos/src/core/di/providers.dart';
import 'package:fess_pos/src/core/runtime/module_runtime.dart';
import 'package:fess_pos/src/core/theme/pos_theme_data.dart';
import 'package:fess_pos/src/features/shell/pos_header.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The widget the host pushes (`PosModule.entryPoint()`).
///
/// Everything the module shows lives under here: its own provider scope
/// (the runtime's container), its own theme and its own nested navigator
/// (docs/03 §3, §7). Pages come from the app definition later (T3-17);
/// until then there is one placeholder home.
class PosEntryPoint extends StatefulWidget {
  const PosEntryPoint({super.key});

  @override
  State<PosEntryPoint> createState() => _PosEntryPointState();
}

class _PosEntryPointState extends State<PosEntryPoint> {
  @override
  void initState() {
    super.initState();
    ModuleRuntime.current?.emit(PosEvent(PosEvent.entryOpened));
  }

  @override
  Widget build(BuildContext context) {
    // The host's navigator: leaving the module pops the host's route.
    final hostNavigator = Navigator.maybeOf(context);
    final VoidCallback? exit = hostNavigator?.maybePop;
    final runtime = ModuleRuntime.current;
    if (runtime == null) {
      return Theme(
        data: buildPosThemeData(PosBrand.resolve()),
        child: _MessagePage(
          message: BundledCopy.text('shell.not_initialized'),
          onBack: exit,
        ),
      );
    }
    return UncontrolledProviderScope(
      container: runtime.container,
      child: Listener(
        behavior: HitTestBehavior.translucent,
        onPointerDown: (_) => runtime.reportUserActivity(),
        child: _PosShell(onExit: exit),
      ),
    );
  }
}

class _PosShell extends ConsumerWidget {
  const _PosShell({required this.onExit});

  final VoidCallback? onExit;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = ref.watch(posThemeDataProvider);
    final snapshot = ref.watch(bootstrapSnapshotProvider);
    final home = snapshot.posEnabled
        ? _MessagePage(
            message: BundledCopy.text('shell.placeholder'),
            onBack: onExit,
          )
        : _MessagePage(
            message: BundledCopy.text('shell.unavailable'),
            onBack: onExit,
          );
    return Theme(
      data: theme,
      child: Navigator(
        pages: [
          MaterialPage<void>(key: const ValueKey('pos-home'), child: home),
        ],
        onDidRemovePage: (_) {},
      ),
    );
  }
}

class _MessagePage extends StatelessWidget {
  const _MessagePage({required this.message, required this.onBack});

  final String message;
  final VoidCallback? onBack;

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: PosHeader(title: BundledCopy.text('shell.title'), onBack: onBack),
    body: Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Text(message, textAlign: TextAlign.center),
      ),
    ),
  );
}
