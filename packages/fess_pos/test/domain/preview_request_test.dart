import 'package:fess_pos/src/domain/preview/preview_request.dart';
import 'package:fess_pos/src/platform/preview/preview_bridge.dart';
import 'package:flutter_test/flutter_test.dart';

const Map<String, Object?> _request = {
  'kind': 'view',
  'definition': {
    'kind': 'view',
    'family': 'home',
    'items': <Object?>[],
  },
  'bundle': {
    'views': {
      'job_card': {'items': <Object?>[]},
    },
    'strings': {'shell.title': 'POS', 'sync.synced': 'All sent'},
  },
  'context': {
    'job': {'id': 'j-1'},
  },
};

void main() {
  test('a request from the studio: its kind, draft, bundle and context '
      '(T3-08)', () {
    final r = PreviewRequest.fromJson(_request)!;
    expect(r.kind, 'view');
    expect(r.family, 'home');
    expect(r.definitionOf('view', 'home'), same(_request['definition']));
    expect(r.definitionOf('view', 'job_card'), {'items': <Object?>[]});
    expect(r.definitionOf('view', 'job_detail'), isNull);
    expect(r.definitionOf('content', 'core'), {
      'strings': {'shell.title': 'POS', 'sync.synced': 'All sent'},
    });
  });

  test("a previewed content definition's strings go over the bundle's", () {
    final r = PreviewRequest.fromJson({
      ..._request,
      'kind': 'content',
      'definition': {
        'kind': 'content',
        'family': 'core',
        'strings': {'sync.synced': 'Up to date'},
      },
    })!;
    expect(r.definitionOf('content', 'core'), {
      'strings': {'shell.title': 'POS', 'sync.synced': 'Up to date'},
    });
  });

  test("what isn't a request is refused", () {
    expect(PreviewRequest.fromJson(null), isNull);
    expect(PreviewRequest.fromJson({'kind': 'view'}), isNull);
    expect(
      PreviewRequest.fromJson({
        'kind': 'spaceship',
        'definition': <String, Object?>{},
      }),
      isNull,
    );
  });

  test('values from JavaScript read as JSON, whole numbers as int', () {
    expect(
      jsonLike({
        1: 'a',
        'n': 10.0,
        'x': 2.5,
        'l': [1.0, null, true],
      }),
      {
        '1': 'a',
        'n': 10,
        'x': 2.5,
        'l': [1, null, true],
      },
    );
    expect(jsonLike(10.0), isA<int>());
  });
}
