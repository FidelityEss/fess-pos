@TestOn('vm')
library;

import 'dart:convert';
import 'dart:io';

import 'package:fess_pos/src/core/config/config_defaults.g.dart';
import 'package:fess_pos/src/core/config/config_leaf.dart';
import 'package:fess_pos/src/core/config/remote_config.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../tool/generate_config_defaults.dart';

/// Formatting aside: whitespace and trailing commas.
String _normalise(String s) => s
    .replaceAll(RegExp(r'\s+'), '')
    .replaceAllMapped(RegExp(r',([\]\)}])'), (m) => m[1]!);

Map<String, Object?> _json(String path) =>
    jsonDecode(File(path).readAsStringSync()) as Map<String, Object?>;

void main() {
  test('config_defaults.g.dart is up to date with schema/config', () {
    expect(
      _normalise(
        File('lib/src/core/config/config_defaults.g.dart').readAsStringSync(),
      ),
      _normalise(
        generateConfigDefaultsDart(
          _json('../../schema/config/defaults.json'),
          _json('../../schema/config/remote-config.schema.json'),
        ),
      ),
      reason: 'run: dart run tool/generate_config_defaults.dart',
    );
  });

  test('the bundled defaults keep their own contract', () {
    expect(const RemoteConfig(bundledConfigDefaults).anomalies, isEmpty);
    expect(configLeaves, isNotEmpty);
  });

  test('before the first pull: the bundled defaults', () {
    const c = RemoteConfig.bundled;
    expect(c.foregroundSyncInterval, const Duration(seconds: 60));
    expect(c.idleSyncInterval, const Duration(seconds: 900));
    expect(c.retainCommittedPayload, const Duration(days: 30));
    expect(c.reverifyEvery, const Duration(hours: 24));
    expect(c.flag('pos.enabled'), isTrue);
    expect(c.versionId, isNull);
  });

  test('a pulled value inside its bounds is used; outside, the default', () {
    const c = RemoteConfig({
      'sync': {'foreground_interval_s': 30, 'idle_interval_s': 5},
    }, versionId: 'cv-1');
    expect(c.foregroundSyncInterval, const Duration(seconds: 30));
    expect(c.idleSyncInterval, const Duration(seconds: 900));
    expect(c.anomalies, ['sync.idle_interval_s']);
    expect(c.versionId, 'cv-1');
  });

  test('a wrong type falls back, and is listed', () {
    const c = RemoteConfig({
      'pos': {'enabled': 'yes'},
      'client_mode': 'desktop',
    });
    expect(c.flag('pos.enabled'), isTrue);
    expect(c.text('client_mode'), 'native');
    expect(c.anomalies, containsAll(['pos.enabled', 'client_mode']));
  });

  test('a key that may be empty takes null or its type', () {
    expect(
      const RemoteConfig({
        'maps': {'tile_url': null},
      }).value('maps.tile_url'),
      isNull,
    );
    expect(
      const RemoteConfig({
        'maps': {'tile_url': 'https://tiles.test/{z}/{x}/{y}.png'},
      }).text('maps.tile_url'),
      'https://tiles.test/{z}/{x}/{y}.png',
    );
  });

  test('a leaf checks type and bounds', () {
    const leaf = ConfigLeaf(ConfigType.integer, min: 15, max: 600);
    expect(leaf.accepts(60), isTrue);
    expect(leaf.accepts(14), isFalse);
    expect(leaf.accepts(601), isFalse);
    expect(leaf.accepts(60.5), isFalse);
    expect(leaf.accepts(null), isFalse);
    expect(
      const ConfigLeaf(
        ConfigType.string,
        values: ['native', 'web'],
      ).accepts('web'),
      isTrue,
    );
  });
}
