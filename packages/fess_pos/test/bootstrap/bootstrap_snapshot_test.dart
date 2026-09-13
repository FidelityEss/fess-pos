@TestOn('vm')
library;

import 'dart:convert';
import 'dart:io';

import 'package:fess_pos/src/bootstrap/bootstrap_cache.dart';
import 'package:fess_pos/src/bootstrap/bootstrap_snapshot.dart';
import 'package:flutter_test/flutter_test.dart';

class _ThrowingCache implements BootstrapCache {
  @override
  Future<String?> read() => Future.error(StateError('keychain locked'));

  @override
  Future<void> write(String snapshotJson) async {}
}

void main() {
  test('the bundled defaults equal schema/config/defaults.json', () {
    final defaults = jsonDecode(
      File('../../schema/config/defaults.json').readAsStringSync(),
    );
    final fromFile = BootstrapSnapshot.fromResolvedConfig(defaults);
    expect(fromFile.anomalies, isEmpty);
    expect(fromFile.toCacheJson(), BootstrapSnapshot.defaults.toCacheJson());
  });

  test('reads valid values', () {
    final s = BootstrapSnapshot.fromResolvedConfig(const {
      'pos': {'enabled': false},
      'inspections': {'start_enabled': false},
      'client_mode': 'web',
      'min_module_version': {
        'nag': '0.2.0',
        'new_work': '0.1.0',
        'block_in_progress': '0.0.1',
      },
      'observability': {
        'sentry_dsn': 'https://k@s.example/1',
        'sample_rate': 1,
      },
      'theme': {'primary_color': '#123456', 'font_family': 'Inter'},
    }, configVersionId: 'cv-1');
    expect(s.anomalies, isEmpty);
    expect(s.posEnabled, isFalse);
    expect(s.inspectionsStartEnabled, isFalse);
    expect(s.clientMode, PosClientMode.web);
    expect(s.minModuleVersionNag, '0.2.0');
    expect(s.sentryDsn, 'https://k@s.example/1');
    expect(s.sentrySampleRate, 1.0);
    expect(s.themePrimaryColor, '#123456');
    expect(s.themeFontFamily, 'Inter');
    expect(s.configVersionId, 'cv-1');
  });

  test('invalid values fall back to the defaults and are reported', () {
    final s = BootstrapSnapshot.fromResolvedConfig(const {
      'pos': {'enabled': 'no'},
      'client_mode': 'desktop',
      'min_module_version': {'new_work': '1.2'},
      'observability': {'sample_rate': 2},
      'theme': {'primary_color': 'green'},
    });
    expect(s.posEnabled, isTrue);
    expect(s.clientMode, PosClientMode.native);
    expect(s.minModuleVersionNewWork, '0.0.0');
    expect(s.sentrySampleRate, 0.2);
    expect(s.themePrimaryColor, isNull);
    expect(
      s.anomalies,
      unorderedEquals([
        'pos.enabled',
        'client_mode',
        'min_module_version.new_work',
        'observability.sample_rate',
        'theme.primary_color',
      ]),
    );
  });

  test('a non-object document gives the defaults', () {
    final s = BootstrapSnapshot.fromResolvedConfig(const [1, 2]);
    expect(s.anomalies, ['(root): not an object']);
    expect(s.posEnabled, isTrue);
  });

  test('the cache round-trips', () {
    final s = BootstrapSnapshot.fromResolvedConfig(const {
      'pos': {'enabled': false},
      'theme': {'primary_color': '#ABCDEF'},
    }, configVersionId: 'cv-9');
    final back = BootstrapSnapshot.fromCacheJson(s.toCacheJson());
    expect(back.toCacheJson(), s.toCacheJson());
    expect(back.configVersionId, 'cv-9');
    expect(back.anomalies, isEmpty);
  });

  test('nothing cached yet gives the defaults, silently', () {
    final s = BootstrapSnapshot.fromCacheJson(null);
    expect(s.anomalies, isEmpty);
    expect(s.posEnabled, isTrue);
  });

  test('a corrupt cache gives the defaults and says so', () {
    final s = BootstrapSnapshot.fromCacheJson('{not json');
    expect(s.anomalies, ['(cache): not JSON']);
    expect(s.posEnabled, isTrue);
  });

  test('loading never throws, even when the cache does', () async {
    final s = await loadBootstrapSnapshot(_ThrowingCache());
    expect(s.anomalies, ['(cache): unreadable']);
    expect(s.posEnabled, isTrue);
  });

  test('storeBootstrapSnapshot caches the bootstrap keys', () async {
    final cache = MemoryBootstrapCache();
    await storeBootstrapSnapshot(cache, {
      'inspections': {'start_enabled': false},
      'maps': {'tile_url': 'ignored'},
    }, configVersionId: 'cv-2');
    final s = await loadBootstrapSnapshot(cache);
    expect(s.inspectionsStartEnabled, isFalse);
    expect(s.configVersionId, 'cv-2');
  });

  test('minimum-version gates (docs/13 §4)', () {
    const current = BootstrapSnapshot.defaults;
    expect(current.newWorkAllowed, isTrue);
    expect(current.updateSuggested, isFalse);
    expect(current.inProgressBlocked, isFalse);
    final old = BootstrapSnapshot.fromResolvedConfig(const {
      'min_module_version': {
        'nag': '9.0.0',
        'new_work': '9.0.0',
        'block_in_progress': '9.0.0',
      },
    });
    expect(old.newWorkAllowed, isFalse);
    expect(old.updateSuggested, isTrue);
    expect(old.inProgressBlocked, isTrue);
  });
}
