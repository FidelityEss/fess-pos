import 'package:fess_pos/src/contract/events.dart';
import 'package:fess_pos/src/core/content/bundled_copy.dart';
import 'package:fess_pos/src/core/di/providers.dart';
import 'package:fess_pos/src/core/runtime/module_runtime.dart';
import 'package:fess_pos/src/core/theme/pos_theme_data.dart';
import 'package:fess_pos/src/domain/navigation/pos_link.dart';
import 'package:fess_pos/src/features/app/pos_router.dart';
import 'package:fess_pos/src/features/shell/pos_header.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The widget the host pushes (`PosModule.entryPoint()`).
///
/// Everything the module shows lives under here: its own provider scope
/// (the runtime's container), its own theme and its own page router, with
/// its own navigator (docs/03 §3, §7), driven by the app definition in
/// force (T3-17).
class PosEntryPoint extends StatefulWidget {
  const PosEntryPoint({super.key});

  @override
  State<PosEntryPoint> createState() => _PosEntryPointState();
}

class _PosEntryPointState extends State<PosEntryPoint> {
  @override
  void initState() {
    super.initState();
    final runtime = ModuleRuntime.current;
    runtime?.emit(PosEvent(PosEvent.entryOpened));
    // Opening POS is a good moment to catch up with the server.
    runtime?.nudgeSync();
  }

  @override
  Widget build(BuildContext context) {
    // The host's navigator: leaving the module pops the host's route.
    final hostNavigator = Navigator.maybeOf(context);
    final VoidCallback? exit = hostNavigator?.maybePop;
    final runtime = ModuleRuntime.current;
    if (runtime == null) {
      // No runtime, so no content yet: the bundled copy.
      return Theme(
        data: buildPosThemeData(PosBrand.resolve()),
        child: _MessagePage(
          title: BundledCopy.text('shell.title'),
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

class _PosShell extends ConsumerStatefulWidget {
  const _PosShell({required this.onExit});

  final VoidCallback? onExit;

  @override
  ConsumerState<_PosShell> createState() => _PosShellState();
}

class _PosShellState extends ConsumerState<_PosShell> {
  final GlobalKey<PosRouterState> _router = GlobalKey();

  late final ModuleRuntime _runtime = ref.read(moduleRuntimeProvider);

  @override
  void initState() {
    super.initState();
    _runtime.pendingLink.addListener(_onLink);
    // A link forwarded before this screen opened.
    WidgetsBinding.instance.addPostFrameCallback((_) => _onLink());
  }

  @override
  void dispose() {
    _runtime.pendingLink.removeListener(_onLink);
    super.dispose();
  }

  /// Opens a forwarded deep link once the agent can see POS; until then it
  /// waits.
  void _onLink() {
    final link = _runtime.pendingLink.value;
    final router = _router.currentState;
    if (!mounted ||
        link == null ||
        router == null ||
        !_runtime.bootstrap.posEnabled ||
        !_runtime.signedIn) {
      return;
    }
    _runtime.pendingLink.value = null;
    router.openLink(link);
    // A job from a link may not have reached the phone yet.
    if (link is JobLink) _runtime.nudgeSync();
  }

  @override
  Widget build(BuildContext context) {
    final theme = ref.watch(posThemeDataProvider);
    final runtime = ref.watch(moduleRuntimeProvider);
    // Switched off or signed out, POS doesn't open its store for content:
    // these messages are the bundled copy.
    const copy = BundledCopy.text;
    final String? message;
    if (!runtime.bootstrap.posEnabled) {
      message = copy('shell.unavailable');
    } else if (!runtime.signedIn) {
      message = copy('shell.not_signed_in');
    } else {
      message = null;
    }
    return Theme(
      data: theme,
      child: message == null
          ? PosRouter(key: _router, onExit: widget.onExit)
          : Navigator(
              pages: [
                MaterialPage<void>(
                  key: const ValueKey('pos-message'),
                  child: _MessagePage(
                    title: copy('shell.title'),
                    message: message,
                    onBack: widget.onExit,
                  ),
                ),
              ],
              onDidRemovePage: (_) {},
            ),
    );
  }
}

class _MessagePage extends StatelessWidget {
  const _MessagePage({
    required this.title,
    required this.message,
    required this.onBack,
  });

  final String title;
  final String message;
  final VoidCallback? onBack;

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: PosHeader(title: title, onBack: onBack),
    body: Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Text(message, textAlign: TextAlign.center),
      ),
    ),
  );
}
