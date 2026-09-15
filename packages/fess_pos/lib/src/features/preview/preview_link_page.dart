import 'package:fess_pos/src/core/di/providers.dart';
import 'package:fess_pos/src/domain/preview/preview_request.dart';
import 'package:fess_pos/src/features/preview/preview_sandbox.dart';
import 'package:fess_pos/src/features/shell/pos_header.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// A draft opened from a "Preview on phone" link (docs/04 §10): fetched by
/// the link's token and drawn in the preview sandbox, where nothing it
/// does is recorded. An unknown or expired token says so.
class PreviewLinkPage extends ConsumerStatefulWidget {
  const PreviewLinkPage({required this.token, super.key});

  final String token;

  @override
  ConsumerState<PreviewLinkPage> createState() => _PreviewLinkPageState();
}

class _PreviewLinkPageState extends ConsumerState<PreviewLinkPage> {
  late final Future<PreviewRequest?> _request = _load();

  Future<PreviewRequest?> _load() async {
    final drafts = await ref.read(previewDraftsProvider.future);
    return drafts?.fetch(widget.token);
  }

  void _close() => Navigator.of(context).pop();

  @override
  Widget build(BuildContext context) {
    final copy = ref.watch(copyProvider);
    return FutureBuilder<PreviewRequest?>(
      future: _request,
      builder: (context, snapshot) {
        final request = snapshot.data;
        if (request != null) {
          return PreviewSandbox(
            request: request,
            platform: ref.read(platformServicesProvider),
            onExit: _close,
          );
        }
        final done = snapshot.connectionState == ConnectionState.done;
        // Unknown or expired: a new link. Couldn't fetch: try again.
        final said = snapshot.hasError
            ? 'preview.offline'
            : 'preview.unavailable';
        return Scaffold(
          appBar: PosHeader(title: copy('preview.label'), onBack: _close),
          body: Center(
            child: done
                ? Padding(
                    padding: const EdgeInsets.all(32),
                    child: Text(
                      copy(said),
                      key: ValueKey('preview-link-$said'),
                      textAlign: TextAlign.center,
                    ),
                  )
                : const CircularProgressIndicator(),
          ),
        );
      },
    );
  }
}
