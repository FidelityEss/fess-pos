import 'dart:async';

import 'package:fess_pos/src/core/di/providers.dart';
import 'package:fess_pos/src/core/preview/preview_inspections.dart';
import 'package:fess_pos/src/core/preview/preview_scope.dart';
import 'package:fess_pos/src/domain/app/app_spec.dart';
import 'package:fess_pos/src/domain/jobs/job_record.dart';
import 'package:fess_pos/src/domain/preview/preview_request.dart';
import 'package:fess_pos/src/features/app/pos_router.dart';
import 'package:fess_pos/src/features/forms/record_form_page.dart';
import 'package:fess_pos/src/features/jobs/job_action_pages.dart';
import 'package:fess_pos/src/features/jobs/job_pages.dart';
import 'package:fess_pos/src/features/shell/pos_header.dart';
import 'package:fess_pos/src/platform/platform_services.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;

/// A preview (docs/04 §10, T3-08, B4.9): [request]'s definition drawn by
/// the module's own renderer, as an agent would see it, with the sample
/// job and agent. It runs in a sandbox of its own: a provider container
/// with no parent, so nothing reads the local store or calls the server,
/// and job actions and form submissions record nothing.
class PreviewSandbox extends StatefulWidget {
  const PreviewSandbox({
    required this.request,
    this.platform,
    this.onExit,
    this.testOverrides = const [],
    super.key,
  });

  final PreviewRequest request;

  /// Opens the phone's own apps (calls, maps) from the preview.
  final PlatformServices? platform;

  /// Leaves the preview, from a top-level page's Back.
  final VoidCallback? onExit;

  /// Added after the sandbox's own, for tests (e.g. a form compiler that
  /// doesn't need an isolate).
  @visibleForTesting
  final List<Override> testOverrides;

  @override
  State<PreviewSandbox> createState() => _PreviewSandboxState();
}

class _PreviewSandboxState extends State<PreviewSandbox> {
  late ProviderContainer _container = _containerFor(widget.request);

  ProviderContainer _containerFor(PreviewRequest request) => ProviderContainer(
    overrides: [
      ...previewOverrides(request, platform: widget.platform),
      ...widget.testOverrides,
    ],
  );

  @override
  void didUpdateWidget(PreviewSandbox old) {
    super.didUpdateWidget(old);
    if (old.request == widget.request) return;
    final previous = _container;
    _container = _containerFor(widget.request);
    // After this frame, once nothing listens to it.
    WidgetsBinding.instance.addPostFrameCallback((_) => previous.dispose());
  }

  @override
  void dispose() {
    _container.dispose();
    super.dispose();
  }

  Widget _alone(Widget page) => Navigator(
    pages: [MaterialPage<void>(child: page)],
    onDidRemovePage: (_) {},
  );

  Widget _page() {
    final request = widget.request;
    final job = previewJob(request);
    final key = request.familyKey;
    final exit = widget.onExit;
    return switch (request.kind) {
      'flow' => _alone(_PreviewFlow(job: job, onBack: exit)),
      'view' => _alone(
        ViewPage(
          view: key,
          pageKey: key,
          // The home view has no job of its own; the others draw the
          // sample job.
          jobId: key == 'home' ? null : job.id,
          onBack: exit,
        ),
      ),
      'job_schema' => _alone(
        ViewPage(
          view: 'job_detail',
          pageKey: 'job_detail',
          jobId: job.id,
          onBack: exit,
        ),
      ),
      'form' => _alone(
        RecordFormPage(
          page: AppPage('preview', {
            'type': 'form_page',
            'form': key,
            'action': 'record.submit',
            'subject': 'job',
            'outcomes': 'default',
          }),
          jobId: job.id,
          onBack: exit,
        ),
      ),
      // An app or content draft runs in the page router.
      _ => PosRouter(onExit: exit),
    };
  }

  @override
  Widget build(BuildContext context) => UncontrolledProviderScope(
    container: _container,
    child: Consumer(
      builder: (context, ref, _) => Theme(
        data: ref.watch(posThemeDataProvider),
        child: Banner(
          message: ref.watch(copyProvider)('preview.label'),
          location: BannerLocation.topEnd,
          // A new request starts afresh: without the key, pages pushed for
          // the last one (an inspection, a job page) would stay on top and
          // ask the new sandbox for what only the old one held.
          child: KeyedSubtree(key: ObjectKey(_container), child: _page()),
        ),
      ),
    ),
  );
}

/// A flow draft (T3-12): the inspection it leads, walked on the sample job
/// as the agent would, its answers held in memory only
/// ([PreviewInspections]). It opens at once; back here, it can be walked
/// again. A flow whose questions the preview doesn't carry says so.
class _PreviewFlow extends ConsumerStatefulWidget {
  const _PreviewFlow({required this.job, this.onBack});

  final JobRecord job;
  final VoidCallback? onBack;

  @override
  ConsumerState<_PreviewFlow> createState() => _PreviewFlowState();
}

class _PreviewFlowState extends ConsumerState<_PreviewFlow> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => unawaited(_start()));
  }

  bool _ready(Object? inspections) =>
      inspections is! PreviewInspections || inspections.formKey != null;

  Future<void> _start() async {
    final inspections = await ref.read(inspectionsProvider.future);
    if (!mounted || inspections == null || !_ready(inspections)) return;
    await openInspection(
      context,
      inspections,
      widget.job,
      ref.read(bankCopyProvider(widget.job.bankId)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final copy = ref.watch(copyProvider);
    final ready = _ready(ref.watch(inspectionsProvider).value);
    return Scaffold(
      appBar: PosHeader(title: copy('shell.title'), onBack: widget.onBack),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                copy(ready ? 'preview.flow_intro' : 'preview.flow_unavailable'),
                key: ValueKey(ready ? 'preview-flow-intro' : 'preview-flow-no'),
                textAlign: TextAlign.center,
              ),
              if (ready) ...[
                const SizedBox(height: 16),
                FilledButton(
                  key: const ValueKey('preview-flow-start'),
                  onPressed: () => unawaited(_start()),
                  child: Text(copy('preview.flow_start')),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
