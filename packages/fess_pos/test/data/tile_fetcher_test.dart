import 'package:fess_pos/src/data/remote/tile_fetcher.dart';
import 'package:fess_pos/src/domain/maps/map_tiles.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

const TileKey _tile = TileKey(17, 75910, 74932);

void main() {
  group('urlFor', () {
    test('fills the tile and the key into the template', () {
      expect(
        TileFetcher.urlFor(
          'https://tiles.test/{z}/{x}/{y}.png?key={api_key}',
          _tile,
          apiKey: 'pk 1',
        ).toString(),
        'https://tiles.test/17/75910/74932.png?key=pk%201',
      );
      expect(
        TileFetcher.urlFor(
          'https://t.test/{z}/{x}/{y}@2x.png?k={key}',
          _tile,
          apiKey: 'a',
        ).toString(),
        'https://t.test/17/75910/74932@2x.png?k=a',
      );
    });

    test('no URL when the key it needs is missing, or it is not web', () {
      expect(
        TileFetcher.urlFor('https://t.test/{z}/{x}/{y}?key={api_key}', _tile),
        isNull,
      );
      expect(TileFetcher.urlFor('ftp://t.test/{z}/{x}/{y}', _tile), isNull);
      expect(
        TileFetcher.urlFor('https://t.test/{z}/{x}/{y}.png', _tile),
        isNotNull,
      );
    });
  });

  group('fetch', () {
    test('the bytes of a 200, with the module named', () async {
      String? agent;
      final fetcher = TileFetcher(
        client: MockClient((req) async {
          agent = req.headers['user-agent'];
          return http.Response.bytes([1, 2, 3], 200);
        }),
      );
      expect(await fetcher.fetch(Uri.parse('https://t.test/1/2/3')), [1, 2, 3]);
      expect(agent, startsWith('fess-pos/'));
    });

    test('nothing for errors, empty bodies and no network', () async {
      Future<List<int>?> answer(Future<http.Response> Function() res) =>
          TileFetcher(
            client: MockClient((_) => res()),
          ).fetch(Uri.parse('https://t.test/1/2/3'));
      expect(await answer(() async => http.Response('', 404)), isNull);
      expect(await answer(() async => http.Response.bytes([], 200)), isNull);
      expect(
        await answer(() async => throw http.ClientException('offline')),
        isNull,
      );
    });
  });
}
