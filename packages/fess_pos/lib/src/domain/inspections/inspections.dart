/// Inspections on the phone (docs/06 §2, docs/07 §4, docs/12 §6–7): begin,
/// capture, keep the answers, submit. The walking skeleton (T4-27) builds
/// the thinnest path through these; each part grows with its own task.
library;

import 'dart:typed_data';

import 'package:fess_pos/src/domain/jobs/job_actions.dart';
import 'package:fess_pos/src/domain/jobs/job_record.dart';
import 'package:meta/meta.dart';

/// Where the phone lets an agent begin an inspection (docs/06 §2): an
/// accepted job, or a returned one for the next attempt.
const Set<String> inspectionBeginStatuses = {'accepted', 'returned'};

/// A photo from the device camera. Only the platform's camera adapter makes
/// one, and the evidence store refuses any other implementation: evidence
/// comes from the camera, never from a file or the gallery (docs/07 §6).
abstract interface class CapturedPhoto {
  Uint8List get bytes;

  String get mimeType;

  /// Device wall time when the shutter fired.
  DateTime get capturedAt;

  /// Deletes the camera's temporary copy, once the store's own is durable.
  Future<void> releaseSource();
}

/// A signature drawn on the phone: its strokes and the PNG they render to,
/// both hashed (docs/07 §4).
@immutable
class SignatureCapture {
  const SignatureCapture({
    required this.strokes,
    required this.png,
    required this.width,
    required this.height,
    required this.capturedAt,
  });

  /// Each stroke's points as `[x, y, ms since the first touch]`.
  final List<List<List<num>>> strokes;
  final Uint8List png;
  final int width;
  final int height;
  final DateTime capturedAt;

  bool get isEmpty => strokes.every((s) => s.isEmpty);
}

/// A declaration's wording, as the agent accepts it (docs/07 §4): the
/// exact version accepted goes into the answers hash.
@immutable
class Declaration {
  const Declaration({
    required this.id,
    required this.key,
    required this.version,
    required this.text,
    this.title,
  });

  /// Null when [json] isn't a stored declaration.
  static Declaration? tryParse(Object? json) {
    if (json is! Map<String, Object?>) return null;
    final id = json['id'];
    final key = json['key'];
    final version = json['version'];
    final text = json['text'];
    final title = json['title'];
    if (id is! String || key is! String || version is! int || text is! String) {
      return null;
    }
    return Declaration(
      id: id,
      key: key,
      version: version,
      text: text,
      title: title is String ? title : null,
    );
  }

  final String id;
  final String key;
  final int version;
  final String text;
  final String? title;
}

/// Declarations on this phone.
// An interface, not a typedef: repositories are swapped as objects.
// ignore: one_member_abstracts
abstract interface class DeclarationRepository {
  /// The latest version of declaration [key], live; null before it arrives.
  Stream<Declaration?> watch(String key);
}

/// An inspection begun on this phone.
@immutable
class InspectionRecord {
  const InspectionRecord({
    required this.id,
    required this.jobId,
    required this.attempt,
    required this.status,
    required this.formVersionId,
    required this.flowVersionId,
    required this.contextSnapshot,
    required this.values,
    required this.otherText,
    required this.currentStep,
    required this.startedAtDevice,
    this.unknownDates = const {},
    this.flaggedDiffers = const {},
    this.flowPath = const [],
    this.submittedAtDevice,
    this.submissionEnvelopeId,
  });

  final String id;
  final String jobId;
  final int attempt;

  /// `in_progress` or `submitted`.
  final String status;

  /// The form and flow versions pinned at the start (docs/04 §7).
  final String formVersionId;
  final String flowVersionId;

  /// What rules read, frozen at the start (docs/04 §4.4).
  final Map<String, Object?> contextSnapshot;

  /// The answers so far, by field key, and the "other" descriptions.
  final Map<String, Object?> values;
  final Map<String, String> otherText;

  /// Dates the agent said they don't know, and prefilled values they
  /// flagged as different on site.
  final Set<String> unknownDates;
  final Set<String> flaggedDiffers;

  /// The flow pages the agent went through to where they are, each
  /// `[step, page]`, so Back retraces a branch; empty in drafts from
  /// before the full flow runner (T3-04).
  final List<List<int>> flowPath;

  /// The flow step the agent is on: its place among the pages shown.
  final int currentStep;
  final String startedAtDevice;
  final String? submittedAtDevice;
  final String? submissionEnvelopeId;

  bool get submitted => status == 'submitted';
}

/// One piece of evidence, as the phone holds it.
@immutable
class EvidenceItem {
  const EvidenceItem({
    required this.id,
    required this.fieldKey,
    required this.type,
    required this.state,
  });

  final String id;
  final String fieldKey;

  /// `photo` or `signature`.
  final String type;

  /// `local_only`, `uploaded`, `verified` or `quarantined` (docs/08 §1).
  final String state;
}

enum BeginStatus {
  /// The inspection, the job's new status and `inspection_started` were
  /// written.
  begun,

  /// The job doesn't allow it on the phone (e.g. not accepted yet).
  notAllowed,

  /// Nobody is signed in with a session that can send it.
  unavailable,

  /// The form or flow in force hasn't reached the phone.
  definitionsMissing,
}

@immutable
class BeginResult {
  const BeginResult(this.status, {this.inspectionId});

  final BeginStatus status;
  final String? inspectionId;
}

/// Inspections on the phone. Every change is written with the envelope
/// that records it, in one local transaction (docs/12 §3).
abstract interface class Inspections implements DeliveryTracker {
  /// Begins an inspection of [job] (docs/06 §2): pins the form and flow in
  /// force, freezes what rules read, takes one location fix and consumes
  /// the job's session token, then records `inspection_started`. A job
  /// with an inspection already open on the phone returns that one.
  Future<BeginResult> begin(JobRecord job);

  /// The latest inspection of [jobId] on this phone, live.
  Stream<InspectionRecord?> watchLatest(String jobId);

  /// One inspection, live.
  Stream<InspectionRecord?> watch(String inspectionId);

  /// Keeps the answers so far and the step (docs/08 §4: nothing typed is
  /// lost to a closed app).
  Future<void> saveDraft(
    String inspectionId, {
    required Map<String, Object?> values,
    required Map<String, String> otherText,
    required int currentStep,
    Set<String> unknownDates = const {},
    Set<String> flaggedDiffers = const {},
    List<List<int>> flowPath = const [],
  });

  /// Stores [photo] for field [fieldKey] and records its `evidence_meta`;
  /// returns the evidence id, the field's answer.
  Future<String> recordPhoto(
    String inspectionId, {
    required String fieldKey,
    required String category,
    required CapturedPhoto photo,
  });

  /// As [recordPhoto], for a drawn signature.
  Future<String> recordSignature(
    String inspectionId, {
    required String fieldKey,
    required SignatureCapture signature,
  });

  /// The bytes of evidence [evidenceId] while the phone still holds them.
  Future<Uint8List?> evidenceBytes(String evidenceId);

  /// The evidence of an inspection, live.
  Stream<List<EvidenceItem>> watchEvidence(String inspectionId);

  /// Seals and records the submission (docs/07 §4 step 9, docs/12 §7): the
  /// [answers] as the form validated them, their hash, the manifest of the
  /// evidence they name and the submission hash.
  Future<JobActionResult> submit(
    String inspectionId, {
    required Map<String, Object?> answers,
  });
}
