@TestOn('vm')
library;

import 'dart:convert';
import 'dart:io';

import 'package:fess_pos/src/core/runtime/module_runtime.dart';
import 'package:fess_pos/src/data/local/custody_note.dart';
import 'package:fess_pos/src/data/outbox/outbox_store.dart';
import 'package:fess_pos/src/platform/database/native_database.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/fake_platform.dart';
import '../support/test_host.dart';

void main() {
  late Directory dir;
  setUp(() => dir = Directory.systemTemp.createTempSync('fess_pos_note_'));
  tearDown(() => dir.deleteSync(recursive: true));

  test('the runtime keeps the note beside the store current (T5-13)', () async {
    addTearDown(ModuleRuntime.reset);
    final runtime = await startTestRuntime(
      platform: fakePlatform(storage: FakeModuleStorage(dir.path)),
    );
    final db = await runtime.localStore();
    Map<String, Object?> note() =>
        jsonDecode(File('${dir.path}/$custodyNoteFile').readAsStringSync())
            as Map<String, Object?>;
    expect(note()['waiting'], 0, reason: 'written as the store opens');

    await OutboxStore(db).add(
      const EnvelopeOrigin(deviceId: 'device-1', clientType: 'native'),
      type: 'client_error',
      typeVersion: 1,
      payload: const {'errors': <Object?>[]},
    );
    for (var i = 0; i < 50 && note()['waiting'] != 1; i++) {
      await Future<void>.delayed(const Duration(milliseconds: 20));
    }
    expect(note()['waiting'], 1, reason: 'and again as work is saved');
  });

  test('the note of unsent work goes aside with a store that can never be '
      'opened again, with why it was moved (T5-13)', () async {
    await writeCustodyNote(
      dir.path,
      OutboxStatus(
        queued: 2,
        inFlight: 0,
        durable: 1,
        needsAttention: 0,
        committed: 5,
        oldestPendingAt: DateTime.utc(2026, 9, 15, 6),
        evidenceWaiting: 1,
      ),
      DateTime.utc(2026, 9, 15, 7),
    );
    final note =
        jsonDecode(File('${dir.path}/$custodyNoteFile').readAsStringSync())
            as Map<String, Object?>;
    expect(note['waiting'], 3, reason: 'two envelopes and a photo');
    expect(note.keys, {
      'waiting',
      'needs_attention',
      'oldest_pending_at',
      'updated_at',
    }, reason: 'numbers and times only');

    File('${dir.path}/$databaseFileName').writeAsStringSync('encrypted');
    final name = await quarantineLocalDatabase(
      dir.path,
      reason: 'LOCAL_STORE_KEY_MISSING',
    );
    expect(File('${dir.path}/$custodyNoteFile').existsSync(), isFalse);
    final details = await readQuarantineDetails(dir.path, [name]);
    expect(details[name]!['reason'], 'LOCAL_STORE_KEY_MISSING');
    expect((details[name]!['custody']! as Map)['waiting'], 3);
  });

  test('a store moved aside with no note says only why', () async {
    File('${dir.path}/$databaseFileName').writeAsStringSync('encrypted');
    final name = await quarantineLocalDatabase(
      dir.path,
      reason: 'LOCAL_STORE_KEY_REJECTED',
    );
    final details = await readQuarantineDetails(dir.path, [name]);
    expect(details[name], {'reason': 'LOCAL_STORE_KEY_REJECTED'});
  });
}
