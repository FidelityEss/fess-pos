import 'package:fess_pos/src/contract/capabilities.dart';
import 'package:fess_pos/src/data/remote/api_session_gateway.dart'
    show capabilityReport;
import 'package:fess_pos/src/domain/flows/flow_runner.dart';
import 'package:fess_pos_engine/fess_pos_engine.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('the capability report says what this build can show', () {
    final report = capabilityReport('native', 'android');
    expect(report['components'], supportedFormComponents);
    expect(report['view_components'], supportedViewComponents);
    expect(report['flow_steps'], supportedFlowSteps);
    expect(report['page_types'], supportedPageTypes);
    expect(report['platform'], 'android');
  });

  test('every form component reported is one the engine knows', () {
    for (final type in supportedFormComponents.keys) {
      expect(formComponentSpec(type), isNotNull, reason: type);
    }
    expect(
      inspectionOnlyComponents.every(supportedFormComponents.containsKey),
      isTrue,
    );
  });

  test('the flow steps reported are the ones the runner runs', () {
    expect(supportedFlowSteps.keys.toSet(), flowStepTypes);
  });
}
