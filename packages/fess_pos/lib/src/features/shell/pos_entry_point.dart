import 'package:fess_pos/src/contract/events.dart';
import 'package:fess_pos/src/core/content/bundled_copy.dart';
import 'package:fess_pos/src/core/di/providers.dart';
import 'package:fess_pos/src/core/runtime/module_runtime.dart';
import 'package:fess_pos/src/core/theme/pos_theme_data.dart';
import 'package:fess_pos/src/features/jobs/job_pages.dart';
import 'package:fess_pos/src/features/shell/pos_header.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The widget the host pushes (`PosModule.entryPoint()`).
///
/// Everything the module shows lives under here: its own provider scope
/// (the runtime's container), its own theme and its own nested navigator
/// (docs/03 §3, §7). The home page lists the agent's jobs and a job opens
/// its detail page; the app definition takes over navigation with T3-17.
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

class _PosShell extends ConsumerStatefulWidget {
  const _PosShell({required this.onExit});

  final VoidCallback? onExit;

  @override
  ConsumerState<_PosShell> createState() => _PosShellState();
}

class _PosShellState extends ConsumerState<_PosShell> {
  /// The job whose detail page is open, if one is.
  String? _openJob;

  void _closeJob() => setState(() => _openJob = null);

  @override
  Widget build(BuildContext context) {
    final theme = ref.watch(posThemeDataProvider);
    final runtime = ref.watch(moduleRuntimeProvider);
    final Widget home;
    if (!runtime.bootstrap.posEnabled) {
      home = _MessagePage(
        message: BundledCopy.text('shell.unavailable'),
        onBack: widget.onExit,
      );
    } else if (!runtime.signedIn) {
      home = _MessagePage(
        message: BundledCopy.text('shell.not_signed_in'),
        onBack: widget.onExit,
      );
    } else {
      home = JobsHomePage(
        onBack: widget.onExit,
        onOpenJob: (id) => setState(() => _openJob = id),
      );
    }
    final job = _openJob;
    return Theme(
      data: theme,
      child: Navigator(
        pages: [
          MaterialPage<void>(key: const ValueKey('pos-home'), child: home),
          if (job != null && runtime.signedIn)
            MaterialPage<void>(
              key: ValueKey('pos-job-$job'),
              child: JobDetailPage(jobId: job, onBack: _closeJob),
            ),
        ],
        onDidRemovePage: (page) {
          if (page.key != const ValueKey('pos-home')) _closeJob();
        },
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
