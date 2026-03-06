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
