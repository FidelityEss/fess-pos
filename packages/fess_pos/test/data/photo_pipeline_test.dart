import 'dart:typed_data';

import 'package:fess_pos/src/data/local/photo_pipeline.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;

/// A red photo with a blue top-left corner, as the camera stores it, with
/// an EXIF orientation tag.
Uint8List _photo(int width, int height, {int orientation = 1}) {
  final image = img.Image(width: width, height: height);
  img.fill(image, color: img.ColorRgb8(200, 30, 30));
  img.fillRect(
    image,
    x1: 0,
    y1: 0,
    x2: width ~/ 4,
    y2: height ~/ 4,
    color: img.ColorRgb8(0, 0, 255),
  );
  image.exif.imageIfd.orientation = orientation;
  return img.encodeJpg(image);
}

bool _blue(img.Image image, int x, int y) {
  final p = image.getPixel(x, y);
  return p.b > 150 && p.r < 100;
}

void main() {
  test('turned upright from its tag, fitted within the long edge, and '
      'stripped of its metadata', () {
    final out = canonicalPhoto(
      PhotoRequest(
        _photo(1600, 1000, orientation: 6),
        maxLongEdge: 1024,
        quality: 80,
      ),
    )!;
    expect((out.width, out.height), (640, 1024));
    final decoded = img.decodeJpg(out.bytes)!;
    expect((decoded.width, decoded.height), (640, 1024));
    expect(decoded.exif.imageIfd.hasOrientation, isFalse);
    expect(decoded.exif.isEmpty, isTrue);
    // Turned a quarter clockwise: the blue corner is now at the top right.
    expect(_blue(decoded, 635, 5), isTrue);
    expect(_blue(decoded, 5, 5), isFalse);
  });

  test('a photo within the limit keeps its size', () {
    final out = canonicalPhoto(
      PhotoRequest(_photo(800, 600), maxLongEdge: 2048, quality: 80),
    )!;
    expect((out.width, out.height), (800, 600));
  });

  test('the quality setting is used', () {
    final bytes = _photo(640, 480);
    final low = canonicalPhoto(
      PhotoRequest(bytes, maxLongEdge: 2048, quality: 50),
    )!;
    final high = canonicalPhoto(
      PhotoRequest(bytes, maxLongEdge: 2048, quality: 95),
    )!;
    expect(low.bytes.length, lessThan(high.bytes.length));
  });

  test('bytes that are no image come back as nothing', () {
    expect(
      canonicalPhoto(
        PhotoRequest(
          Uint8List.fromList([1, 2, 3]),
          maxLongEdge: 2048,
          quality: 80,
        ),
      ),
      isNull,
    );
  });

  test('on a background isolate, the same result', () async {
    final out = await canonicalPhotoInBackground(
      PhotoRequest(
        _photo(1600, 1000, orientation: 6),
        maxLongEdge: 1024,
        quality: 80,
      ),
    );
    expect((out!.width, out.height), (640, 1024));
  });
}
