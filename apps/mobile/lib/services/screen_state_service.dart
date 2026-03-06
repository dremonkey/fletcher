import 'package:flutter/services.dart';

class ScreenStateService {
  static const _channel = MethodChannel('com.fletcher.fletcher/screen_state');

  static Future<bool> isScreenLocked() async {
    try {
      return await _channel.invokeMethod<bool>('isScreenLocked') ?? false;
    } catch (_) {
      return false;
    }
  }
}
