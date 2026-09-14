import 'package:fess_pos/fess_pos.dart';
import 'package:fess_pos/src/core/runtime/module_runtime.dart';
import 'package:fess_pos/src/domain/navigation/pos_link.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/test_host.dart';

const String _job = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

void main() {
  tearDown(ModuleRuntime.reset);

  test('a POS push is recognised before the module starts', () async {
    expect(await PosModule.handlePushPayload({'source': 'fess_pos'}), isTrue);
    expect(await PosModule.handlePushPayload({'source': 'other'}), isFalse);
  });

  test('a push tells the host which hint, and nothing more', () async {
    final events = <PosEvent>[];
    await startTestRuntime(config: testConfig(onEvent: events.add));
    await PosModule.handlePushPayload({
      'source': 'fess_pos',
      'kind': 'sync',
      'hint': 'job_assigned',
      'job_id': _job,
    });
    await PosModule.handlePushPayload({
      'source': 'fess_pos',
      'hint': 'Hello <b>there</b>',
    });
    final pushes = events.where((e) => e.name == PosEvent.pushReceived);
    expect(pushes.map((e) => e.properties), [
      {'hint': 'job_assigned'},
      <String, Object?>{},
    ]);
  });

  test('a deep link waits for the POS screen', () async {
    final events = <PosEvent>[];
    final runtime = await startTestRuntime(
      config: testConfig(onEvent: events.add),
    );
    expect(
      await PosModule.handleDeepLink(Uri.parse('fess://pos/job/$_job')),
      isTrue,
    );
    expect(runtime.pendingLink.value, const JobLink(_job));
    final opened = events.singleWhere((e) => e.name == PosEvent.deepLinkOpened);
    expect(opened.properties, {'page': 'job'}, reason: 'never the job id');
    expect(
      await PosModule.handleDeepLink(Uri.parse('fidelity://fess.com/home')),
      isFalse,
    );
    expect(runtime.pendingLink.value, const JobLink(_job));
  });

  test('signing out drops a link that is still waiting', () async {
    final runtime = await startTestRuntime();
    await PosModule.signIn(testIdentity());
    await PosModule.handleDeepLink(Uri.parse('fess://pos/card'));
    await PosModule.signOut();
    expect(runtime.pendingLink.value, isNull);
  });
}
