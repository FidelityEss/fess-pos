import 'package:fess_pos/src/contract/theme.dart';
import 'package:fess_pos/src/core/di/providers.dart';
import 'package:fess_pos/src/core/preview/preview_inspections.dart';
import 'package:fess_pos/src/core/theme/pos_theme_data.dart';
import 'package:fess_pos/src/data/outbox/outbox_store.dart' show OutboxStatus;
import 'package:fess_pos/src/domain/forms/form_submissions.dart';
import 'package:fess_pos/src/domain/forms/reason_codes.dart';
import 'package:fess_pos/src/domain/inspections/inspections.dart';
import 'package:fess_pos/src/domain/jobs/job_actions.dart';
import 'package:fess_pos/src/domain/jobs/job_record.dart';
import 'package:fess_pos/src/domain/preview/preview_request.dart';
import 'package:fess_pos/src/domain/storage/storage_budget.dart';
import 'package:fess_pos/src/domain/sync/attention.dart';
import 'package:fess_pos/src/domain/sync/lost_store.dart';
import 'package:fess_pos/src/domain/sync/power_status.dart';
import 'package:fess_pos/src/platform/platform_services.dart';
import 'package:flutter/material.dart' show Color;
import 'package:flutter_riverpod/misc.dart' show Override;

/// What a preview's definitions are named by: there is no pinned version.
final String _previewHash = '0' * 64;

/// The sample job a preview draws with, from the request's `context.job`.
JobRecord previewJob(PreviewRequest request) {
  final raw = request.context['job'];
  final job = raw is Map<String, Object?> ? raw : const <String, Object?>{};
  String text(Object? v, String fallback) => v is String ? v : fallback;
  final id = text(job['id'], 'preview-job');
  final bank = job['bank'];
  final bankId = bank is Map<String, Object?> ? bank['id'] : null;
  final scheduled = job['scheduled'];
  return JobRecord(
    id: id,
    reference: text(job['reference'], 'POS-PREVIEW'),
    status: text(job['status'], 'assigned'),
    assignedToMe: true,
    bankId: bankId is String ? bankId : null,
    data: {
      ...job,
      'id': id,
      if (scheduled is Map<String, Object?>) ...{
        'scheduled_start': scheduled['start'],
        'scheduled_end': scheduled['end'],
      },
    },
  );
}

/// The brand a preview draws with: the request's `theme` over the design
/// tokens, as remote config's `theme.*` would set it (D-45).
PosBrand previewBrand(PreviewRequest request) {
  final hex = request.theme['primary_color'];
  final font = request.theme['font_family'];
  final rgb = hex is String && RegExp(r'^#[0-9A-Fa-f]{6}$').hasMatch(hex)
      ? int.parse(hex.substring(1), radix: 16)
      : null;
  return PosBrand.resolve(
    host: PosTheme(
      primaryColor: rgb == null ? null : Color(0xFF000000 | rgb),
      fontFamily: font is String && font.trim().isNotEmpty ? font : null,
    ),
  );
}

/// A declaration's wording as the preview carries it (`bundle.declarations`,
/// `{key: {title, text}}`); null when it doesn't.
Declaration? previewDeclaration(PreviewRequest request, String key) {
  final all = request.bundle['declarations'];
  final d = all is Map<String, Object?> ? all[key] : null;
  if (d is! Map<String, Object?>) return null;
  final text = d['text'];
  final title = d['title'];
  if (text is! String) return null;
  return Declaration(
    id: previewVersionId('declaration', key),
    key: key,
    version: 1,
    text: text,
    title: title is String ? title : null,
  );
}

/// The overrides that keep a preview in its sandbox (docs/04 §10). Every
/// definition comes from [request]; the job, the agent and the totals are
/// its sample ones; nothing reads the local store or calls the server; job
/// actions and form submissions end as if the server had them and record
/// nothing, and an inspection's answers and photos stay in memory
/// ([PreviewInspections]). [platform] opens the phone's own apps (calls,
/// maps).
List<Override> previewOverrides(
  PreviewRequest request, {
  PlatformServices? platform,
}) {
  final job = previewJob(request);
  final agent = request.context['agent'];
  final stats = request.context['stats'];
  final brand = previewBrand(request);
  return [
    posBrandProvider.overrideWithValue(brand),
    posThemeDataProvider.overrideWithValue(buildPosThemeData(brand)),
    definitionVersionProvider.overrideWith(
      (ref, versionId) async => request.definitionOfVersion(versionId),
    ),
    declarationProvider.overrideWith(
      (ref, key) => Stream.value(previewDeclaration(request, key)),
    ),
    storageUseProvider.overrideWith((ref) async => StorageUse.unknown),
    activeDefinitionProvider.overrideWith(
      (ref, key) => Stream.value(request.definitionOf(key.kind, key.key)),
    ),
    activeDefinitionVersionProvider.overrideWith((ref, key) {
      final body = request.definitionOf(key.kind, key.key);
      return Stream.value(
        body == null
            ? null
            : ActiveDefinition(
                versionId: 'preview',
                hash: _previewHash,
                body: body,
              ),
      );
    }),
    myJobsProvider.overrideWith((ref) => Stream.value([job])),
    jobProvider.overrideWith(
      (ref, id) => Stream.value(id == job.id ? job : null),
    ),
    agentProvider.overrideWith(
      (ref) => Stream.value(agent is Map<String, Object?> ? agent : null),
    ),
    agentTotalsProvider.overrideWith(
      (ref) => Stream.value(stats is Map<String, Object?> ? stats : null),
    ),
    agentCardProvider.overrideWith((ref) => Stream.value(null)),
    jobCardProvider.overrideWith((ref, id) => Stream.value(null)),
    syncStatusProvider.overrideWith(
      (ref) => Stream.value(
        const OutboxStatus(
          queued: 0,
          inFlight: 0,
          durable: 0,
          needsAttention: 0,
          committed: 0,
        ),
      ),
    ),
    syncingProvider.overrideWith((ref) => Stream.value(false)),
    lostStoresProvider.overrideWith(
      (ref) => Stream.value(const <LostStore>[]),
    ),
    powerStatusProvider.overrideWith((ref) async => PowerStatus.unknown),
    offlineReadyJobsProvider.overrideWith((ref) => Stream.value({job.id})),
    needsAttentionProvider.overrideWith(
      (ref) => Stream.value(const <AttentionItem>[]),
    ),
    inspectionsProvider.overrideWith((ref) {
      final inspections = PreviewInspections(request);
      ref.onDispose(inspections.dispose);
      return inspections;
    }),
    reasonCodesProvider.overrideWith(
      (ref) => Stream.value(const <ReasonCode>[]),
    ),
    jobActionsProvider.overrideWith((ref) async => const PreviewJobActions()),
    formSubmissionsProvider.overrideWith(
      (ref) async => const PreviewFormSubmissions(),
    ),
    if (platform != null) platformServicesProvider.overrideWithValue(platform),
  ];
}

/// Job actions in a preview: each ends as if the server had it, and
/// nothing is recorded.
class PreviewJobActions implements JobActions {
  const PreviewJobActions();

  @override
  Future<JobActionResult> record(
    JobRecord job,
    JobAction action, {
    ReasonSubmission? reason,
  }) async => const JobActionResult.recorded('preview');

  @override
  Future<void> sendNow() async {}

  @override
  Stream<DeliveryState> watchDelivery(String envelopeId) =>
      Stream.value(DeliveryState.delivered);
}

/// Form submissions in a preview: each ends as if the server had it, and
/// nothing is recorded.
class PreviewFormSubmissions implements FormSubmissions {
  const PreviewFormSubmissions();

  @override
  Future<JobActionResult> submit(FormSubmission submission) async =>
      const JobActionResult.recorded('preview');

  @override
  Future<void> sendNow() async {}

  @override
  Stream<DeliveryState> watchDelivery(String envelopeId) =>
      Stream.value(DeliveryState.delivered);
}
