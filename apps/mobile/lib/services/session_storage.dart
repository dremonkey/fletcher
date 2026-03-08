import 'dart:io' show Platform;
import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Persists the last room name and connection timestamp so the client can
/// decide whether to rejoin an existing room or create a new one.
///
/// A session is considered "stale" if the time since last connection exceeds
/// the server's departure_timeout — the room will have been closed by then.
class SessionStorage {
  static const _keyRoomName = 'fletcher_last_room';
  static const _keyConnectedAt = 'fletcher_last_connected_at';

  /// Cached device ID — the hardware ID never changes at runtime.
  static String? _cachedDeviceId;

  /// Returns a stable participant identity derived from the hardware device ID.
  ///
  /// - Android: `Settings.Secure.ANDROID_ID` (persists across reinstalls)
  /// - iOS: `identifierForVendor` (persists while any vendor app is installed)
  /// - Fallback: timestamp-based ID (should never happen on mobile)
  static Future<String> getDeviceId() async {
    if (_cachedDeviceId != null) return _cachedDeviceId!;

    final deviceInfo = DeviceInfoPlugin();
    String platformId;

    if (Platform.isAndroid) {
      final android = await deviceInfo.androidInfo;
      platformId = android.id;
    } else if (Platform.isIOS) {
      final ios = await deviceInfo.iosInfo;
      platformId = ios.identifierForVendor ?? 'unknown-ios';
    } else {
      platformId = 'unknown-${DateTime.now().millisecondsSinceEpoch}';
    }

    _cachedDeviceId = 'device-$platformId';
    debugPrint('[SessionStorage] Device ID: $_cachedDeviceId');
    return _cachedDeviceId!;
  }

  /// Save the current room name and timestamp.
  static Future<void> saveSession(String roomName) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_keyRoomName, roomName);
    await prefs.setInt(_keyConnectedAt, DateTime.now().millisecondsSinceEpoch);
    debugPrint('[SessionStorage] Saved session: room=$roomName');
  }

  /// Retrieve the last session if it exists and is not stale.
  ///
  /// [stalenessThreshold] should match the server's `departure_timeout` —
  /// after that duration the room is guaranteed to be closed.
  static Future<String?> getRecentRoom({
    required Duration stalenessThreshold,
  }) async {
    final prefs = await SharedPreferences.getInstance();
    final roomName = prefs.getString(_keyRoomName);
    final connectedAt = prefs.getInt(_keyConnectedAt);

    if (roomName == null || connectedAt == null) {
      debugPrint('[SessionStorage] No saved session');
      return null;
    }

    final elapsed = DateTime.now().millisecondsSinceEpoch - connectedAt;
    final elapsedDuration = Duration(milliseconds: elapsed);

    if (elapsedDuration > stalenessThreshold) {
      debugPrint(
        '[SessionStorage] Stale session: room=$roomName '
        'age=${elapsedDuration.inSeconds}s > threshold=${stalenessThreshold.inSeconds}s',
      );
      return null;
    }

    debugPrint(
      '[SessionStorage] Recent session: room=$roomName '
      'age=${elapsedDuration.inSeconds}s',
    );
    return roomName;
  }

  /// Clear saved session state.
  static Future<void> clearSession() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_keyRoomName);
    await prefs.remove(_keyConnectedAt);
    debugPrint('[SessionStorage] Cleared session');
  }
}
