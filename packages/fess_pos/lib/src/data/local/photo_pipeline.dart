import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:image/image.dart' as img;

/// A photo to make canonical, and the limits from remote config
/// (`photos.max_long_edge_px`, `photos.jpeg_quality`).
@immutable
class PhotoRequest {
  const PhotoRequest(
    this.bytes, {
    required this.maxLongEdge,
    required this.quality,
  });

  final Uint8List bytes;
  final int maxLongEdge;
  final int quality;
}

/// The canonical image: what is hashed, stored and uploaded.
@immutable
class CanonicalPhoto {
  const CanonicalPhoto(this.bytes, {required this.width, required this.height});

  final Uint8List bytes;
  final int width;
  final int height;
}

/// The canonical photo (docs/07 §4 step 2, B5.2, B5.7, T4-02): the
/// camera's image turned upright from its orientation tag, fitted within
/// the long-edge limit, stripped of its metadata (EXIF, including any
/// location, and the colour profile) and JPEG-encoded. Null when the bytes
/// aren't an image this can read.
CanonicalPhoto? canonicalPhoto(PhotoRequest request) {
  img.Image? decoded;
  try {
    decoded = img.decodeImage(request.bytes);
  } on Object {
    // A decoder that recognised the bytes but couldn't read them.
    decoded = null;
  }
  if (decoded == null) return null;
  var image = img.bakeOrientation(decoded);
  if (math.max(image.width, image.height) > request.maxLongEdge) {
    image = image.width >= image.height
        ? img.copyResize(
            image,
            width: request.maxLongEdge,
            interpolation: img.Interpolation.linear,
          )
        : img.copyResize(
            image,
            height: request.maxLongEdge,
            interpolation: img.Interpolation.linear,
          );
  }
  image
    ..exif = img.ExifData()
    ..iccProfile = null;
  return CanonicalPhoto(
    img.encodeJpg(image, quality: request.quality),
    width: image.width,
    height: image.height,
  );
}

/// [canonicalPhoto] on a background isolate, so decoding and encoding never
/// hold up the screen (docs/03 §8); on the web, on the main thread.
Future<CanonicalPhoto?> canonicalPhotoInBackground(PhotoRequest request) =>
    compute(canonicalPhoto, request, debugLabel: 'fess_pos canonical photo');
