@TestOn('vm')
library;

import 'dart:convert';
import 'dart:io';

import 'package:drift/native.dart';
import 'package:fess_pos/src/data/local/pos_database.dart';
import 'package:fess_pos/src/data/outbox/outbox_store.dart';
import 'package:fess_pos/src/data/sync/sync_report.dart';
import 'package:fess_pos/src/domain/sync/power_status.dart';
import 'package:flutter_test/flutter_test.dart';

const EnvelopeOrigin _device = EnvelopeOrigin(
  deviceId: 'device-1',
  clientType: 'native',
);

const Duration _every = Duration(hours: 6);

void main() {
  late PosDatabase db;
  late OutboxStore outbox;
  late DateTime now;
  late PowerStatus power;
  late int? free;

  setUp(() {
    db = PosDatabase(NativeDatabase.memory());
    now = DateTime(2026, 9, 15, 10);
    outbox = OutboxStore(db, clock: () => now);
    power = const PowerStatus(
      batteryOptimised: true,
      backgroundRestricted: false,
    );
    free = 2 * 1024 * 1024 * 1024;
  });
  tearDown(() => db.close());

  SyncReporter reporter() => SyncReporter(
    outbox: outbox,
    power: () async => power,
    freeDiskBytes: () async => free,
    configVersionId: () => '0191d3c2-7a4e-7c1b-9f10-4b2e1c0a9d82',
    capabilities: const {'module_version': '0.0.0'},
    clock: () => now,
  );

  Future<List<Map<String, Object?>>> reports() async => [
    for (final row in await db.select(db.outbox).get())
      if (row.type == 'sync_report')
        (jsonDecode(row.envelope) as Map<String, Object?>)['payload']!
            as Map<String, Object?>,
  ];

  test('the report has what the server schema asks for, and nothing else '
      '(T5-02)', () async {
    await outbox.add(
      _device,
      type: 'traces_batch',
      typeVersion: 1,
      payload: const {'a': 1},
    );
    expect(await reporter().reportIfDue(_device, every: _every), isTrue);
    final payload = (await reports()).single;
    final schema =
        jsonDecode(
              File(
                '../../schema/api/payloads/sync_report.v1.schema.json',
              ).readAsStringSync(),
            )
            as Map<String, Object?>;
    expect(
      payload.keys,
      containsAll((schema['required']! as List).cast<String>()),
    );
    expect(
      (schema['properties']! as Map).keys,
      containsAll(payload.keys),
      reason: 'the schema is strict: an unknown key is refused',
    );
    expect(payload['pending'], {'traces_batch': 1});
    expect(payload['battery_restricted'], isTrue);
    expect(payload['background_restricted'], isFalse);
    expect(payload['free_storage_mb'], 2048);
    expect(payload['evidence'], {
      'local_only': 0,
      'uploading': 0,
      'uploaded': 0,
      'verified_retained': 0,
    });
  });

  test('sent every interval, sooner when the battery status changes, and '
      'never with a guessed free storage', () async {
    final r = reporter();
    expect(await r.reportIfDue(_device, every: _every), isTrue);
    now = now.add(const Duration(hours: 1));
    expect(await r.reportIfDue(_device, every: _every), isFalse);

    power = const PowerStatus(
      batteryOptimised: false,
      backgroundRestricted: false,
    );
    expect(
      await r.reportIfDue(_device, every: _every),
      isTrue,
      reason: 'the agent exempted the app',
    );

    now = now.add(_every);
    free = null;
    expect(
      await r.reportIfDue(_device, every: _every),
      isFalse,
      reason: 'free storage unknown: wait rather than guess',
    );
    free = 1024 * 1024;
    expect(await r.reportIfDue(_device, every: _every), isTrue);
    expect(await reports(), hasLength(3));
  });

  test('a clean sync run is the last success it reports', () async {
    expect(
      (await reporter().payload(
        power: power,
        freeBytes: 0,
        state: const {},
        now: now,
      ))['last_success_at'],
      isNull,
    );
    await recordSyncSuccess(db, now);
    expect(await reporter().reportIfDue(_device, every: _every), isTrue);
    expect((await reports()).single['last_success_at'], isNotNull);
  });
}
