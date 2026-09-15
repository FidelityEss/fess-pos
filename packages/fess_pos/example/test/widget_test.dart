import 'dart:convert';

import 'package:fess_pos_example/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('the harness opens the module entry point', (tester) async {
    await tester.pumpWidget(const HarnessApp());
    await tester.pumpAndSettle();
    expect(find.textContaining('fess_pos '), findsOneWidget);
    expect(find.text('access: notInitialized'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('harness-login')),
      findsNothing,
      reason: 'no logins without the defines',
    );

    await tester.tap(find.text('Open POS'));
    await tester.pumpAndSettle();
    // Not initialised in this test: the module says so instead of failing.
    expect(
      find.text('POS verification is not set up in this app.'),
      findsOneWidget,
    );
  });

  test('logins come from the defines: several agents, or one', () {
    final issued = DateTime.utc(2026, 9, 14, 6);
    final many = harnessLogins(
      logins: jsonEncode([
        {
          'employee_number': 'SEED-AG01',
          'token': 't1',
          'issued_at': issued.toIso8601String(),
        },
        {'employee_number': 'SEED-AG02', 'token': 't2'},
        {'employee_number': 'SEED-AG03'},
      ]),
      token: 'single',
    );
    expect(many.map((l) => l.employeeNumber), ['SEED-AG01', 'SEED-AG02']);
    expect(many.first.expiresAt, issued.add(const Duration(hours: 24)));
    expect(many.first.expiredAt(issued.add(const Duration(hours: 25))), isTrue);
    expect(many.last.expiredAt(DateTime.now()), isFalse, reason: 'no time');

    final one = harnessLogins(
      token: 'single',
      employeeNumber: 'SEED-AG01',
      issuedAt: issued.toIso8601String(),
    );
    expect(one.single.token, 'single');
    expect(harnessLogins(logins: 'not json', token: 'single'), hasLength(1));
    expect(harnessLogins(), isEmpty, reason: 'no defines in this test');
  });
}
