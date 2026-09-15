import 'package:fess_pos/src/domain/inspections/inspections.dart';
import 'package:fess_pos_engine/fess_pos_engine.dart' show ResolvedField;
import 'package:flutter/widgets.dart';

/// Where a photo stands in its field: the [number]th, and how many a guided
/// sequence asks for ([of], null otherwise).
@immutable
class PhotoShot {
  const PhotoShot({this.number = 1, this.of});

  final int number;
  final int? of;
}

EvidenceItem? _noEvidence(String evidenceId) => null;

/// What the evidence and legal fields need from the inspection they belong
/// to (T4-27): the camera, the signature pad, the phone's copy of the
/// evidence and the declarations. Outside an inspection there are none,
/// and those fields show a notice instead.
@immutable
class FormFieldServices {
  const FormFieldServices({
    required this.takePhoto,
    required this.drawSignature,
    required this.evidenceImage,
    required this.declaration,
    this.evidence = _noEvidence,
    this.pickPin,
    this.now = DateTime.now,
  });

  /// Opens the camera for a field and stores what it takes, with the
  /// caption the field asks for. The new evidence id, or null when the
  /// agent went back without a photo.
  final Future<String?> Function(
    BuildContext context,
    ResolvedField field,
    PhotoShot shot,
  )
  takePhoto;

  /// Opens the signature pad for a field and stores the signature. The new
  /// evidence id, or null.
  final Future<String?> Function(BuildContext context, ResolvedField field)
  drawSignature;

  /// A piece of evidence, by id, as an image of the given size, while the
  /// phone holds it.
  final Widget Function(String evidenceId, double size) evidenceImage;

  /// A piece of evidence as the phone recorded it (its caption, who
  /// signed); null until it shows.
  final EvidenceItem? Function(String evidenceId) evidence;

  /// Opens the map to place a pin for a field (T4-11), from `current` or
  /// where the field starts (`initial`): the pin `{lat, lng, source}`, or
  /// null when the agent goes back. Null where no map is at hand.
  final Future<Map<String, Object?>?> Function(
    BuildContext context,
    ResolvedField field,
    Map<String, Object?>? current,
  )?
  pickPin;

  /// A declaration, by key, as on the phone; null before it arrives.
  final Declaration? Function(String key) declaration;

  final DateTime Function() now;
}
