import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:vad/vad.dart';

/// Local Voice Activity Detection service using Silero VAD v5.
///
/// Runs on-device speech detection when the agent is not connected.
/// Calls [onSpeechDetected] when confirmed speech is detected,
/// which triggers agent dispatch.
class LocalVadService {
  VadHandler? _vadHandler;
  bool _isListening = false;
  StreamSubscription? _speechSubscription;

  /// Callback fired when confirmed speech is detected.
  final VoidCallback onSpeechDetected;

  /// Whether the service is currently listening for speech.
  bool get isListening => _isListening;

  LocalVadService({required this.onSpeechDetected});

  /// Start listening for speech via the device microphone.
  ///
  /// Uses Silero VAD v5 model with tuned thresholds:
  /// - positiveSpeechThreshold: 0.5 (confidence floor for speech)
  /// - negativeSpeechThreshold: 0.35 (confidence floor for non-speech)
  /// - minSpeechFrames: 3 (minimum frames before confirming speech)
  Future<void> startListening() async {
    if (_isListening) return;

    _vadHandler = VadHandler.create(isDebug: false);

    // Use onRealSpeechStart (not onSpeechStart) — it waits for
    // minSpeechFrames to confirm speech, reducing false positives
    // from brief noises.
    _speechSubscription = _vadHandler!.onRealSpeechStart.listen((_) {
      debugPrint('[LocalVAD] Speech detected — triggering dispatch');
      onSpeechDetected();
    });

    await _vadHandler!.startListening(
      positiveSpeechThreshold: 0.5,
      negativeSpeechThreshold: 0.35,
      minSpeechFrames: 3,
      model: 'v5',
      frameSamples: 512,
    );

    _isListening = true;
    debugPrint('[LocalVAD] Started listening');
  }

  /// Stop listening and release the microphone.
  Future<void> stopListening() async {
    if (!_isListening) return;

    await _speechSubscription?.cancel();
    _speechSubscription = null;

    _vadHandler?.stopListening();
    _vadHandler?.dispose();
    _vadHandler = null;

    _isListening = false;
    debugPrint('[LocalVAD] Stopped listening');
  }

  /// Dispose the service and release all resources.
  void dispose() {
    stopListening();
  }
}
