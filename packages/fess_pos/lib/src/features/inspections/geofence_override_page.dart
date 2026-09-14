import 'package:fess_pos/src/core/di/providers.dart';
import 'package:fess_pos/src/domain/forms/reason_codes.dart';
import 'package:fess_pos/src/domain/forms/reason_form.dart';
import 'package:fess_pos/src/domain/jobs/job_record.dart';
import 'package:fess_pos/src/features/jobs/job_pages.dart';
import 'package:fess_pos/src/features/shell/pos_header.dart';
import 'package:fess_pos/src/renderer/form/form_controller.dart';
import 'package:fess_pos/src/renderer/form/form_services.dart';
import 'package:fess_pos/src/renderer/form/form_view.dart';
import 'package:fess_pos_engine/fess_pos_engine.dart'
    show ResolveContext, answersHash;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The reason-code category an override's reason comes from.
const String overrideReasonCategory = 'geofence_override';

T? _data<T>(AsyncValue<T> value) => switch (value) {
  AsyncData(:final value) => value,
  _ => null,
};

/// The geofence override (docs/07 §7 item 6, T4-10, B3.3): the bank's
/// override form, by default a reason, a note and photos of the shopfront
/// in context, filled in inside the inspection. It returns the
/// `override_detail` of `geofence_result`, or null when the agent goes
/// back. The inspection is then flagged `geofence_override` for review.
class GeofenceOverridePage extends ConsumerStatefulWidget {
  const GeofenceOverridePage({
    required this.job,
    required this.formKey,
    required this.services,
    required this.distanceM,
    required this.allowedMaxM,
    super.key,
  });

  final JobRecord job;

  /// The flow's `override_form`.
  final String formKey;

  /// The inspection's camera: the photos are evidence of the inspection.
  final FormFieldServices services;

  /// How far from the pin the agent is, and how far an override may be.
  final double distanceM;
  final double allowedMaxM;

  @override
  ConsumerState<GeofenceOverridePage> createState() =>
      _GeofenceOverridePageState();
}

class _GeofenceOverridePageState extends ConsumerState<GeofenceOverridePage> {
  FormController? _form;
  String? _formVersion;

  @override
  void dispose() {
    _form?.dispose();
    super.dispose();
  }

  FormController _controllerFor(
    String versionId,
    Map<String, Object?> body,
    ReasonFormFields fields,
    List<ReasonCode> codes,
    Map<String, Object?>? agent,
    String Function(String key) copy,
  ) {
    final existing = _form;
    if (existing != null && _formVersion == versionId) return existing;
    if (existing != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) => existing.dispose());
    }
    _formVersion = versionId;
    return _form = FormController(
      definition: body,
      lists: reasonCodeLists(codes, bankId: widget.job.bankId),
      inspection: true,
      context: ResolveContext(
        today: todayIso(),
        job: jobViewData(widget.job),
        agent: agent,
      ),
      extraChecks: (answers) => fields.check(
        answers,
        codes,
        category: overrideReasonCategory,
        message: copy,
      ),
    );
  }

  void _submit(
    String versionId,
    String hash,
    Map<String, Object?> body,
    ReasonFormFields fields,
    FormController form,
  ) {
    if (!form.validate()) return;
    final answers = form.answers;
    final code = fields.reasonCode(answers);
    if (code == null) return;
    Navigator.of(context).pop(<String, Object?>{
      'reason_code': code,
      'note': fields.note(answers) ?? '',
      'form_version_id': versionId,
      'definition_hash': hash,
      'answers': answers,
      'answers_hash': answersHash(answers),
      'photo_evidence_ids': _photoIds(body, answers),
      'distance_m': (widget.distanceM * 10).roundToDouble() / 10,
      'allowed_max_m': widget.allowedMaxM,
    });
  }

  /// The evidence ids the form's photo fields hold.
  static List<String> _photoIds(
    Map<String, Object?> form,
    Map<String, Object?> answers,
  ) {
    final ids = <String>[];
    void visit(Object? fields) {
      if (fields is! List<Object?>) return;
      for (final f in fields.whereType<Map<String, Object?>>()) {
        final key = f['key'];
        if (f['type'] == 'photo' && key is String) {
          final entry = answers[key];
          final v = entry is Map<String, Object?> ? entry['v'] : null;
          if (v is List<Object?>) ids.addAll(v.whereType<String>());
        }
        visit(f['fields']);
      }
    }

    final sections = form['sections'];
    if (sections is List<Object?>) {
      for (final s in sections.whereType<Map<String, Object?>>()) {
        visit(s['fields']);
      }
    }
    return ids;
  }

  Widget _message(String text) => Center(
    child: Padding(
      padding: const EdgeInsets.all(24),
      child: Text(text, textAlign: TextAlign.center),
    ),
  );

  @override
  Widget build(BuildContext context) {
    final copy = ref.watch(copyProvider);
    final definition = ref.watch(
      activeDefinitionVersionProvider((
        kind: 'form',
        key: widget.formKey,
        bankId: widget.job.bankId,
      )),
    );
    final codes = _data(ref.watch(reasonCodesProvider));
    final agent = _data(ref.watch(agentProvider));
    Widget body;
    Widget? submit;
    switch (definition) {
      case AsyncData(value: final found?) when codes != null:
        final fields = ReasonFormFields.of(found.body, overrideReasonCategory);
        if (fields == null) {
          body = _message(copy('form.unavailable'));
          break;
        }
        final form = _controllerFor(
          found.versionId,
          found.body,
          fields,
          codes,
          agent,
          copy,
        );
        body = ListView(
          children: [
            FormView(controller: form, copy: copy, services: widget.services),
          ],
        );
        submit = SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
            child: FilledButton(
              key: const ValueKey('override-submit'),
              onPressed: () => _submit(
                found.versionId,
                found.hash,
                found.body,
                fields,
                form,
              ),
              child: Text(copy('override.submit')),
            ),
          ),
        );
      case AsyncData(value: null):
        body = _message(copy('job.action.form_missing'));
      case AsyncError():
        body = _message(copy('shell.unavailable'));
      default:
        body = const Center(child: CircularProgressIndicator());
    }
    return Scaffold(
      appBar: PosHeader(
        title: copy('override.title'),
        onBack: () => Navigator.of(context).pop(),
      ),
      body: body,
      bottomNavigationBar: submit,
    );
  }
}
