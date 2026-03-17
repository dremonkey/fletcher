import 'dart:async';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart';

/// Abstraction over [Connectivity] for testability.
abstract class ConnectivityProvider {
  Future<List<ConnectivityResult>> checkConnectivity();
  Stream<List<ConnectivityResult>> get onConnectivityChanged;
}

/// Default implementation that delegates to [Connectivity] from
/// connectivity_plus.
class RealConnectivityProvider implements ConnectivityProvider {
  final Connectivity _connectivity = Connectivity();

  @override
  Future<List<ConnectivityResult>> checkConnectivity() =>
      _connectivity.checkConnectivity();

  @override
  Stream<List<ConnectivityResult>> get onConnectivityChanged =>
      _connectivity.onConnectivityChanged;
}

/// Lightweight service that tracks network connectivity state.
///
/// Exposes a synchronous [isOnline] getter and a [Stream<bool>] for
/// online/offline transitions. Used by [LiveKitService] to make smarter
/// reconnection decisions (e.g. pause retries while offline).
class ConnectivityService extends ChangeNotifier {
  final ConnectivityProvider _provider;
  StreamSubscription<List<ConnectivityResult>>? _subscription;

  bool _isOnline = true;
  List<ConnectivityResult> _currentResults = [];

  /// Whether the device currently has any network connection.
  bool get isOnline => _isOnline;

  /// Current connectivity types (wifi, mobile, etc.).
  List<ConnectivityResult> get currentResults => _currentResults;

  /// Stream that emits `true` when the device goes online and `false`
  /// when it goes offline. Only emits on actual state changes.
  final StreamController<bool> _onlineController =
      StreamController<bool>.broadcast();
  Stream<bool> get onConnectivityChanged => _onlineController.stream;

  ConnectivityService({ConnectivityProvider? provider})
      : _provider = provider ?? RealConnectivityProvider() {
    _init();
  }

  Future<void> _init() async {
    // Get initial state
    final results = await _provider.checkConnectivity();
    _update(results);

    // Listen for changes
    _subscription = _provider.onConnectivityChanged.listen(_update);
  }

  void _update(List<ConnectivityResult> results) {
    final previousResults = _currentResults;
    _currentResults = results;
    final online = !results.every((r) => r == ConnectivityResult.none);

    if (online != _isOnline) {
      _isOnline = online;
      debugPrint('[Connectivity] ${online ? "Online" : "Offline"} ($results)');
      _onlineController.add(online);
      notifyListeners();
    } else if (online && _isOnline && !_sameInterfaces(previousResults, results)) {
      // Network interface changed while staying online (e.g. WiFi → cellular).
      // Emit a synthetic offline→online pulse so reconnect logic triggers. (BUG-046)
      debugPrint('[Connectivity] Interface switch: $previousResults → $results');
      _onlineController.add(false);
      _onlineController.add(true);
      notifyListeners();
    }
  }

  /// Compare two connectivity result lists ignoring order.
  bool _sameInterfaces(List<ConnectivityResult> a, List<ConnectivityResult> b) {
    if (a.length != b.length) return false;
    final sortedA = List<ConnectivityResult>.from(a)..sort((x, y) => x.index.compareTo(y.index));
    final sortedB = List<ConnectivityResult>.from(b)..sort((x, y) => x.index.compareTo(y.index));
    for (var i = 0; i < sortedA.length; i++) {
      if (sortedA[i] != sortedB[i]) return false;
    }
    return true;
  }

  @override
  void dispose() {
    _subscription?.cancel();
    _onlineController.close();
    super.dispose();
  }
}
