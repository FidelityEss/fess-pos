import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:fess_pos/src/platform/connectivity.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('NetworkState.fromResults', () {
    const offline = NetworkState.offline;
    const wifi = NetworkState(connected: true, unmetered: true);
    // Same values as NetworkState.unknown, different meaning.
    // ignore: use_named_constants
    const cellular = NetworkState(connected: true, unmetered: false);
    final cases = <List<ConnectivityResult>, NetworkState>{
      const []: offline,
      const [ConnectivityResult.none]: offline,
      const [ConnectivityResult.wifi]: wifi,
      const [ConnectivityResult.ethernet]: wifi,
      const [ConnectivityResult.mobile]: cellular,
      const [ConnectivityResult.mobile, ConnectivityResult.vpn]: cellular,
      const [ConnectivityResult.vpn, ConnectivityResult.wifi]: wifi,
      const [ConnectivityResult.other]: cellular,
    };
    for (final MapEntry(key: results, value: expected) in cases.entries) {
      expect(NetworkState.fromResults(results), expected, reason: '$results');
    }
  });

  test('unknown is optimistic about syncing, cautious about Wi-Fi', () {
    expect(NetworkState.unknown.connected, isTrue);
    expect(NetworkState.unknown.unmetered, isFalse);
  });
}
