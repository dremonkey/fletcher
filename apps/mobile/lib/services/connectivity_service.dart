import 'dart:async';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart';

/// Lightweight service that tracks network connectivity state.
///
/// Exposes a synchronous [isOnline] getter and a [Stream<bool>] for
/// online/offline transitions. Used by [LiveKitService] to make smarter
/// reconnection decisions (e.g. pause retries while offline).
class ConnectivityService extends ChangeNotifier {
  final Connectivity _connectivity = Connectivity();
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

  ConnectivityService() {
    _init();
  }

  Future<void> _init() async {
    // Get initial state
    final results = await _connectivity.checkConnectivity();
    _update(results);

    // Listen for changes
    _subscription = _connectivity.onConnectivityChanged.listen(_update);
  }

  void _update(List<ConnectivityResult> results) {
    _currentResults = results;
    final online = !results.every((r) => r == ConnectivityResult.none);

    if (online != _isOnline) {
      _isOnline = online;
      debugPrint('[Connectivity] ${online ? "Online" : "Offline"} ($results)');
      _onlineController.add(online);
      notifyListeners();
    }
  }

  @override
  void dispose() {
    _subscription?.cancel();
    _onlineController.close();
    super.dispose();
  }
}
