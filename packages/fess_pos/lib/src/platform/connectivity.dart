import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:meta/meta.dart';

/// What the network looks like right now.
///
/// A hint only. [connected] means an interface is up, not that the POS API
/// answers. Delivery never depends on it: the outbox keeps retrying until the
/// server's receipt says the data is safe (docs/12 §4).
@immutable
class NetworkState {
  const NetworkState({required this.connected, required this.unmetered});

  factory NetworkState.fromResults(List<ConnectivityResult> results) {
    final up = results.where((r) => r != ConnectivityResult.none);
    return NetworkState(
      connected: up.isNotEmpty,
      unmetered: up.any(
        (r) => r == ConnectivityResult.wifi || r == ConnectivityResult.ethernet,
      ),
    );
  }

  static const NetworkState offline = NetworkState(
    connected: false,
    unmetered: false,
  );

  /// When the platform can't say: try to sync (a failed attempt costs
  /// little), but don't assume Wi-Fi.
  static const NetworkState unknown = NetworkState(
    connected: true,
    unmetered: false,
  );

  final bool connected;

  /// Wi-Fi or ethernet: for `maps.wifi_only_prefetch`.
  final bool unmetered;

  @override
  bool operator ==(Object other) =>
      other is NetworkState &&
      other.connected == connected &&
      other.unmetered == unmetered;

  @override
  int get hashCode => Object.hash(connected, unmetered);

  @override
  String toString() =>
      'NetworkState(connected: $connected, unmetered: $unmetered)';
}

abstract interface class ConnectivityMonitor {
  Future<NetworkState> current();

  Stream<NetworkState> get changes;
}

/// connectivity_plus, on every platform including the web.
class PluginConnectivityMonitor implements ConnectivityMonitor {
  PluginConnectivityMonitor([Connectivity? connectivity])
    : _connectivity = connectivity ?? Connectivity();

  final Connectivity _connectivity;

  @override
  Future<NetworkState> current() async {
    try {
      return NetworkState.fromResults(
        await _connectivity.checkConnectivity(),
      );
    } on Object {
      return NetworkState.unknown;
    }
  }

  @override
  Stream<NetworkState> get changes =>
      _connectivity.onConnectivityChanged.map(NetworkState.fromResults);
}
