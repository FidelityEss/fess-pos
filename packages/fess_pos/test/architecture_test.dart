// Architecture rules from docs/03 §3 and docs/DEVELOPMENT-GUIDELINES.md §2,
// checked against the source. A failure names the file and the rule.
@TestOn('vm')
library;

import 'dart:io';

import 'package:fess_pos/src/core/version.dart';
import 'package:flutter_test/flutter_test.dart';

/// Source lines with comments removed, so docs may name what code must not.
String _code(File f) =>
    f.readAsLinesSync().where((l) => !l.trimLeft().startsWith('//')).join('\n');

List<File> _dartFiles(String dir) =>
    Directory(dir)
        .listSync(recursive: true)
        .whereType<File>()
        .where((f) => f.path.endsWith('.dart'))
        .toList()
      ..sort((a, b) => a.path.compareTo(b.path));

String _rel(File f) => f.path.replaceAll(r'\', '/');

void main() {
  final lib = _dartFiles('lib');

  test('lib/fess_pos.dart is the only public library', () {
    final top = Directory(
      'lib',
    ).listSync().whereType<File>().map((f) => f.uri.pathSegments.last).toList();
    expect(top, ['fess_pos.dart']);
  });

  const forbidden = <String, String>{
    'package:supabase': 'no Supabase SDK in the module (docs/03 §3)',
    'Supabase.': 'never touch the host Supabase client (docs/03 §3)',
    'package:sentry_flutter': "use the module's own Sentry Hub (docs/03 §7)",
    'SentryFlutter': "use the module's own Sentry Hub (docs/03 §7)",
    'Sentry.init(': 'the app-wide Sentry hub belongs to the host',
    'FlutterError.onError =': 'no global error handlers',
    'PlatformDispatcher.instance.onError =': 'no global error handlers',
    'ErrorWidget.builder =': 'no global error widget',
    'onBackgroundMessage': 'the FCM background handler belongs to the host',
    'package:firebase_': 'no dependency on host Firebase',
    'FFAppState': 'never touch FESS globals (findings/03 §3)',
    'appNavigatorKey': 'never touch FESS globals (findings/03 §3)',
    'ApiManager': 'never touch FESS globals (findings/03 §3)',
    'package:go_router': 'FESS pins go_router; use the own router (docs/03 §7)',
    'package:image_picker': 'camera-only capture (docs/07 §6)',
    '.deleteAll(': 'never wipe secure storage the host shares (findings/03 §2)',
  };

  // The one place allowed to delete all: FlutterSecureStore.reset, whose
  // fixed options confine it to the module's own namespace (D-52).
  const deleteAllAllowedIn = 'lib/src/platform/secure_store.dart';

  for (final f in lib) {
    test('${_rel(f)} uses no forbidden API', () {
      final code = _code(f);
      for (final e in forbidden.entries) {
        if (e.key == '.deleteAll(' && _rel(f) == deleteAllAllowedIn) continue;
        expect(
          code.contains(e.key),
          isFalse,
          reason: '${_rel(f)} contains "${e.key}": ${e.value}',
        );
      }
    });
  }

  test('dart:io and dart:ffi appear only under lib/src/platform/', () {
    for (final f in lib) {
      if (_rel(f).startsWith('lib/src/platform/')) continue;
      final code = _code(f);
      expect(
        code.contains("'dart:io'") || code.contains("'dart:ffi'"),
        isFalse,
        reason:
            '${_rel(f)}: platform code belongs behind platform/ '
            '(web build, docs/13 §8)',
      );
    }
  });

  test('plugins and native database code are used only under platform/', () {
    const platformOnly = [
      'package:camera_platform_interface/',
      'package:camera_android/',
      'package:camera_avfoundation/',
      'package:camera_web/',
      'package:connectivity_plus/',
      'package:device_info_plus/',
      'package:flutter_secure_storage/',
      'package:geolocator/',
      'package:package_info_plus/',
      'package:path_provider/',
      'package:sqlcipher_flutter_libs/',
      'package:sqlite3/',
      'package:url_launcher/',
      'package:workmanager/',
      'package:drift/native.dart',
      'package:drift/wasm.dart',
    ];
    for (final f in lib) {
      if (_rel(f).startsWith('lib/src/platform/')) continue;
      final code = _code(f);
      for (final import in platformOnly) {
        expect(
          code.contains("'$import"),
          isFalse,
          reason:
              '${_rel(f)} imports $import: platform code belongs behind '
              'lib/src/platform/ (docs/03 §2)',
        );
      }
    }
  });

  test('only data/remote/ talks HTTP, and screens never reach it', () {
    for (final f in lib) {
      final path = _rel(f);
      final code = _code(f);
      if (!path.startsWith('lib/src/data/remote/')) {
        expect(
          code.contains("'package:http/"),
          isFalse,
          reason:
              '$path imports package:http: the POS API client lives in '
              'lib/src/data/remote/ (docs/03 §4)',
        );
      }
      if (path.startsWith('lib/src/features/')) {
        expect(
          code.contains('src/data/remote/'),
          isFalse,
          reason:
              '$path: screens never touch the API client '
              '(DEVELOPMENT-GUIDELINES §2)',
        );
      }
    }
  });

  test('screens and the renderer never import the data layer', () {
    for (final f in lib) {
      final path = _rel(f);
      if (!path.startsWith('lib/src/features/') &&
          !path.startsWith('lib/src/renderer/')) {
        continue;
      }
      expect(
        _code(f).contains('src/data/'),
        isFalse,
        reason:
            '$path: UI reaches data through domain interfaces and providers '
            '(DEVELOPMENT-GUIDELINES §2)',
      );
    }
  });

  test('bootstrap/ imports no feature, data or renderer code', () {
    for (final f in _dartFiles('lib/src/bootstrap')) {
      final code = _code(f);
      for (final layer in ['src/features/', 'src/data/', 'src/renderer/']) {
        expect(code.contains(layer), isFalse, reason: '${_rel(f)} → $layer');
      }
    }
  });

  test('domain/ depends on no UI, data or platform code', () {
    final dir = Directory('lib/src/domain');
    if (!dir.existsSync()) return;
    for (final f in _dartFiles(dir.path)) {
      final code = _code(f);
      for (final layer in [
        'src/features/',
        'src/data/',
        'src/platform/',
        'package:flutter/',
      ]) {
        expect(code.contains(layer), isFalse, reason: '${_rel(f)} → $layer');
      }
    }
  });

  test('pubspec has no forbidden dependency', () {
    final pubspec = File('pubspec.yaml').readAsStringSync();
    for (final name in [
      'supabase',
      'supabase_flutter',
      'go_router',
      'image_picker',
      'sentry_flutter',
      'firebase_core',
      'firebase_messaging',
      // Would ship plain SQLite beside SQLCipher (docs/03 §7).
      'sqlite3_flutter_libs',
      // Brings CameraX, which can need a higher minSdk than the host (D-54).
      'camera',
    ]) {
      expect(
        RegExp('^\\s+$name:', multiLine: true).hasMatch(pubspec),
        isFalse,
        reason: 'pubspec.yaml depends on $name',
      );
    }
  });

  test('PosVersions.module matches pubspec.yaml', () {
    final version = RegExp(
      r'^version:\s*(\S+)',
      multiLine: true,
    ).firstMatch(File('pubspec.yaml').readAsStringSync())!.group(1);
    expect(PosVersions.module, version);
  });
}
