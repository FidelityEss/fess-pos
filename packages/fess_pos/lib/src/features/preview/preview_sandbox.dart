import 'package:fess_pos/src/core/content/bundled_copy.dart';
import 'package:fess_pos/src/core/di/providers.dart';
import 'package:fess_pos/src/core/preview/preview_scope.dart';
import 'package:fess_pos/src/core/theme/pos_theme_data.dart';
import 'package:fess_pos/src/domain/app/app_spec.dart';
import 'package:fess_pos/src/domain/preview/preview_request.dart';
import 'package:fess_pos/src/features/app/pos_router.dart';
import 'package:fess_pos/src/features/forms/record_form_page.dart';
import 'package:fess_pos/src/features/jobs/job_pages.dart';
import 'package:fess_pos/src/features/shell/pos_header.dart';
import 'package:fess_pos/src/platform/platform_services.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

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
    super.key,
  });

  final PreviewRequest request;

  /// Opens the phone's own apps (calls, maps) from the preview.
  final PlatformServices? platform;

  /// Leaves the preview, from a top-level page's Back.
  final VoidCallback? onExit;

  @override
  State<PreviewSandbox> createState() => _PreviewSandboxState();
}

class _PreviewSandboxState extends State<PreviewSandbox> {
  late ProviderContainer _container = _containerFor(widget.request);

  ProviderContainer _containerFor(PreviewRequest request) => ProviderContainer(
    overrides: previewOverrides(request, platform: widget.platform),
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
    final key = request.family ?? '';
    final exit = widget.onExit;
    return switch (request.kind) {
      'app' || 'content' => PosRouter(onExit: exit),
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
      _ => _alone(_FlowNotice(onBack: exit)),
    };
  }

  @override
  Widget build(BuildContext context) => UncontrolledProviderScope(
    container: _container,
    child: Consumer(
      builder: (context, ref, _) => Theme(
        data: buildPosThemeData(PosBrand.resolve()),
        child: Banner(
          message: ref.watch(copyProvider)('preview.label'),
          location: BannerLocation.topEnd,
          child: _page(),
        ),
      ),
    ),
  );
}

/// Flows don't run in the sandbox yet (T3-32).
class _FlowNotice extends StatelessWidget {
  const _FlowNotice({this.onBack});

  final VoidCallback? onBack;

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: PosHeader(title: BundledCopy.text('shell.title'), onBack: onBack),
    body: Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Text(
          BundledCopy.text('preview.flow_unavailable'),
          textAlign: TextAlign.center,
        ),
      ),
    ),
  );
}
