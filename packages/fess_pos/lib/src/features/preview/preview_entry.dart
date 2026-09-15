import 'dart:async';

import 'package:fess_pos/src/contract/capabilities.dart';
import 'package:fess_pos/src/core/content/bundled_copy.dart';
import 'package:fess_pos/src/core/theme/pos_theme_data.dart';
import 'package:fess_pos/src/core/version.dart';
import 'package:fess_pos/src/domain/app/app_spec.dart';
import 'package:fess_pos/src/domain/preview/preview_request.dart';
import 'package:fess_pos/src/features/preview/preview_sandbox.dart';
import 'package:fess_pos/src/platform/platform_services.dart';
import 'package:fess_pos/src/platform/preview/preview_bridge.dart';
import 'package:flutter/material.dart';

/// The preview says it's ready, with what this build can draw.
const String previewReady = 'fess_pos.preview.ready';

/// The embedding page sends a request: `{type, version, request}`.
const String previewRender = 'fess_pos.preview.render';

/// The preview answers each request: `{type, version, ok, problems}`.
const String previewRendered = 'fess_pos.preview.rendered';

/// What the preview can't draw as the request stands: an app definition's
/// problems (the module would stand the bundled app in), or a flow whose
/// questions it doesn't carry (it can't be walked through, T3-12).
List<String> previewProblems(PreviewRequest request) {
  switch (request.kind) {
    case 'app':
      try {
        AppSpec.parse(
          request.definition,
          pageTypes: supportedPageTypes.keys.toSet(),
        );
        return const [];
      } on AppSpecError catch (e) {
        return e.problems;
      }
    case 'flow':
      final form = request.definition['form_family'];
      if (form is! String) {
        const unnamed =
            "the flow doesn't name its questions (form_family), so it can't "
            'be walked through';
        return const [unnamed];
      }
      if (request.definitionOf('form', form) == null) {
        final missing =
            "the flow's questions ($form) aren't in the preview, so it can't "
            'be walked through';
        return [missing];
      }
  }
  return const [];
}

/// The module's preview app (T3-08): the admin's definitions studio embeds
/// the module's web build and sends it drafts over `postMessage` (docs/03
/// §5, docs/04 §10). It says it's ready, draws each request in the preview
/// sandbox and answers with what it found. Messages from any origin but
/// [allowedOrigins] (the page's own when none are given) are ignored.
class PosPreviewEntry extends StatefulWidget {
  const PosPreviewEntry({
    this.allowedOrigins = const [],
    this.bridge,
    this.platform,
    super.key,
  });

  final List<String> allowedOrigins;

  /// The bridge to the embedding page; the web's own when null.
  final PreviewBridge? bridge;

  /// Opens the device's own apps; the current platform's when null.
  final PlatformServices? platform;

  @override
  State<PosPreviewEntry> createState() => _PosPreviewEntryState();
}

class _PosPreviewEntryState extends State<PosPreviewEntry> {
  late final PreviewBridge _bridge =
      widget.bridge ?? createPreviewBridge(widget.allowedOrigins);
  late final PlatformServices _platform =
      widget.platform ?? PlatformServices.forCurrentPlatform();
  StreamSubscription<Map<String, Object?>>? _messages;
  PreviewRequest? _request;

  @override
  void initState() {
    super.initState();
    _messages = _bridge.messages.listen(_onMessage);
    _bridge.send({
      'type': previewReady,
      'version': 1,
      'module_version': PosVersions.module,
      'capabilities': {
        'components': supportedFormComponents,
        'view_components': supportedViewComponents,
        'flow_steps': supportedFlowSteps,
        'page_types': supportedPageTypes,
      },
    });
  }

  void _onMessage(Map<String, Object?> message) {
    if (message['type'] != previewRender) return;
    final request = PreviewRequest.fromJson(message['request']);
    if (request == null) {
      _bridge.send({
        'type': previewRendered,
        'version': 1,
        'ok': false,
        'problems': const ['not a preview request'],
      });
      return;
    }
    final problems = previewProblems(request);
    setState(() => _request = request);
    _bridge.send({
      'type': previewRendered,
      'version': 1,
      'ok': problems.isEmpty,
      'problems': problems,
    });
  }

  @override
  void dispose() {
    unawaited(_messages?.cancel());
    _bridge.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final request = _request;
    if (request == null) {
      return Theme(
        data: buildPosThemeData(PosBrand.resolve()),
        child: Scaffold(
          body: Center(
            child: Padding(
              padding: const EdgeInsets.all(32),
              child: Text(
                BundledCopy.text('preview.waiting'),
                key: const ValueKey('preview-waiting'),
                textAlign: TextAlign.center,
              ),
            ),
          ),
        ),
      );
    }
    return PreviewSandbox(request: request, platform: _platform);
  }
}
