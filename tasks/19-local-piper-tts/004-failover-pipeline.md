# Task 004: Fail-Over Pipeline & Data Channel Bridge

**Epic:** 19 - Local Piper TTS Integration
**Status:** 📋 Backlog
**Depends on:** 002 (Sherpa-ONNX Integration), 003 (Model Selection)

## Discovery Notes (from Task 001 research, 2026-03-08)

**Concerns and dependencies identified during discovery:**

1. **Server-side infrastructure already exists.** The `tts-fallback-monitor.ts` already publishes "Voice Degraded" and "Voice Restored" artifacts via the data channel. The "Voice Unavailable" state (all TTS failed) is handled separately in `agent.ts`. The mobile client just needs to listen for these events -- no new protocol needed.

2. **Blocking synthesis call.** `sherpa-onnx` `generate()` is synchronous and blocks for 500-1800ms depending on text length and device. Must run on a Dart `Isolate`. The `VoiceFallbackController` design in this task spec needs to account for async isolate communication and buffer management.

3. **Audio playback conflict.** When switching from cloud TTS (LiveKit audio track) to local TTS (raw PCM), there may be a conflict. LiveKit audio track may still be subscribed. Need to either mute the remote track or mix audio. Design decision needed.

4. **Model availability.** The download-on-first-use strategy (Task 003) means the model may NOT be available when the first fallback is triggered. The `VoiceFallbackController` must handle the case where local TTS is requested but the model hasn't been downloaded yet. Options: show a "downloading voice pack" toast, or fall back to text-only mode.

5. **ConnectivityService already exists.** The Flutter app already has a working `ConnectivityService` at `apps/mobile/lib/services/connectivity_service.dart` with `isOnline` getter and `onConnectivityChanged` stream. No need to create a new one (Task 006 spec incorrectly proposes a new service).

## Objective

Wire local Piper TTS into the voice pipeline as the **ultimate fallback layer**, triggered automatically when server-side TTS fails or is unavailable.

## Problem Statement

### Current Behavior (Silent Delivery)

```
1. User speaks
2. OpenClaw responds → transcript deltas arrive via data channel
3. Voice agent TTS fails (rate limit, timeout, error)
4. Result: User sees text but hears nothing ❌
```

### Target Behavior (Fail-Over)

```
1. User speaks
2. OpenClaw responds → transcript deltas arrive via data channel
3. Voice agent TTS fails → sends "voice unavailable" artifact
4. App detects failure → switches to LOCAL PIPER
5. Result: User sees text AND hears local voice ✅
```

## Architecture

### Current Voice Pipeline

```
LiveKit Room
  ├─ Audio Track (Server TTS)
  │   ├─ Primary: Google Cloud TTS
  │   └─ Fallback: Server Piper Sidecar
  │
  └─ Data Channel (ganglia-events topic)
      └─ Transcript Deltas (always reliable)
```

### New Fail-Over Pipeline

```
LiveKit Room
  ├─ Audio Track (Server TTS)
  │   ├─ Primary: Google Cloud TTS
  │   └─ Fallback Tier 1: Server Piper Sidecar
  │
  └─ Data Channel (ganglia-events topic)
      └─ Transcript Deltas → [NEW] VoiceFallbackController
                                ├─ Detects TTS failure
                                ├─ Buffers transcript deltas
                                └─ Pipes to LocalPiperTTS (Fallback Tier 2)
                                    └─ AudioOutputService
```

**Key Insight:** Transcript deltas are already arriving reliably via the data channel. We just need to detect when audio fails and pipe those deltas to local synthesis.

## Implementation

### 1. Fail-Over Detection Logic

Create a controller that monitors voice availability:

**lib/services/voice_fallback_controller.dart:**
```dart
import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:fletcher/models/ganglia_event.dart';
import 'package:fletcher/services/local_piper_tts.dart';
import 'package:fletcher/services/audio_output_service.dart';

enum VoiceMode {
  cloudTts,       // Using server-side TTS (normal)
  localFallback,  // Using local Piper (fallback)
}

class VoiceFallbackController extends ChangeNotifier {
  final LocalPiperTTS _localTts;
  final AudioOutputService _audioOutput;
  
  VoiceMode _mode = VoiceMode.cloudTts;
  VoiceMode get mode => _mode;
  
  DateTime? _lastAudioSample;
  final List<String> _transcriptBuffer = [];
  Timer? _watchdogTimer;
  
  VoiceFallbackController({
    required LocalPiperTTS localTts,
    required AudioOutputService audioOutput,
  })  : _localTts = localTts,
        _audioOutput = audioOutput;
  
  /// Called when a transcript delta arrives
  void onTranscriptDelta(String delta) {
    _transcriptBuffer.add(delta);
    
    // Start watchdog timer if not already running
    _startWatchdog();
  }
  
  /// Called when a "voice unavailable" artifact arrives
  void onVoiceUnavailableArtifact() {
    debugPrint('VoiceFallbackController: Explicit voice unavailable signal');
    _switchToLocalTts();
  }
  
  /// Called when audio samples are received from LiveKit
  void onAudioSample() {
    _lastAudioSample = DateTime.now();
    
    // Cancel watchdog if audio is flowing
    _cancelWatchdog();
    
    // Reset to cloud mode if we were in fallback
    if (_mode == VoiceMode.localFallback) {
      debugPrint('VoiceFallbackController: Audio resumed, switching back to cloud');
      _switchToCloudTts();
    }
  }
  
  /// Called when network connectivity is lost
  void onOfflineMode() {
    debugPrint('VoiceFallbackController: Offline mode detected');
    _switchToLocalTts();
  }
  
  /// Called when conversation turn ends
  void onTurnComplete() {
    _transcriptBuffer.clear();
    _cancelWatchdog();
  }
  
  /// Start watchdog timer to detect audio timeout
  void _startWatchdog() {
    _cancelWatchdog();
    
    _watchdogTimer = Timer(Duration(seconds: 2), () {
      // If we have transcript but no audio for 2 seconds, switch to local
      if (_transcriptBuffer.isNotEmpty && _shouldTriggerFallback()) {
        debugPrint('VoiceFallbackController: Audio timeout detected');
        _switchToLocalTts();
      }
    });
  }
  
  void _cancelWatchdog() {
    _watchdogTimer?.cancel();
    _watchdogTimer = null;
  }
  
  bool _shouldTriggerFallback() {
    // Already in fallback mode
    if (_mode == VoiceMode.localFallback) return false;
    
    // No transcript yet
    if (_transcriptBuffer.isEmpty) return false;
    
    // Check if audio is timing out
    if (_lastAudioSample == null) return true;
    
    final timeSinceAudio = DateTime.now().difference(_lastAudioSample!);
    return timeSinceAudio > Duration(seconds: 2);
  }
  
  Future<void> _switchToLocalTts() async {
    if (_mode == VoiceMode.localFallback) return;
    
    debugPrint('VoiceFallbackController: Switching to local TTS');
    _mode = VoiceMode.localFallback;
    notifyListeners();
    
    // Synthesize buffered transcript
    final fullText = _transcriptBuffer.join();
    if (fullText.isNotEmpty) {
      await _synthesizeLocally(fullText);
    }
    
    // Clear buffer after synthesis
    _transcriptBuffer.clear();
  }
  
  void _switchToCloudTts() {
    _mode = VoiceMode.cloudTts;
    _transcriptBuffer.clear();
    notifyListeners();
  }
  
  Future<void> _synthesizeLocally(String text) async {
    try {
      await for (final samples in _localTts.synthesizeStream(text)) {
        await _audioOutput.playPcmSamples(samples);
      }
    } catch (e) {
      debugPrint('Local TTS synthesis failed: $e');
    }
  }
  
  @override
  void dispose() {
    _cancelWatchdog();
    super.dispose();
  }
}
```

### 2. Update GangliaEventService

Wire the fallback controller into the event stream:

**lib/services/ganglia_event_service.dart:**
```dart
class GangliaEventService {
  final VoiceFallbackController _voiceFallback;
  
  void _handleEvent(GangliaEvent event) {
    switch (event.type) {
      case 'transcript_delta':
        _voiceFallback.onTranscriptDelta(event.delta);
        break;
        
      case 'artifact':
        if (event.artifactType == 'voice_unavailable') {
          _voiceFallback.onVoiceUnavailableArtifact();
        }
        break;
    }
  }
}
```

### 3. Update LiveKit Audio Handling

Monitor audio track samples to detect when audio is flowing:

**lib/services/livekit_service.dart:**
```dart
class LiveKitService {
  final VoiceFallbackController _voiceFallback;
  
  void _onAudioFrame(AudioFrame frame) {
    // Signal that audio is arriving
    _voiceFallback.onAudioSample();
    
    // Normal audio playback
    _audioOutput.playFrame(frame);
  }
}
```

### 4. Server-Side Changes (Voice Agent)

Add explicit "voice unavailable" artifact when TTS fails:

**apps/voice-agent/src/agent.ts:**
```typescript
import { publishEvent } from './ganglia';

// Error handler for TTS failures
session.on(voice.AgentSessionEventTypes.Error, (ev) => {
  const error = ev.error;
  
  // Detect TTS-related errors
  const isTtsError = 
    error.message.includes('TTS') ||
    error.message.includes('synthesis') ||
    error.message.includes('text-to-speech') ||
    error.message.includes('rate limit');
  
  if (isTtsError) {
    logger.warn({ error }, 'TTS failure detected, signaling mobile fallback');
    
    // Publish explicit fallback signal
    publishEvent({
      type: 'artifact',
      artifact_type: 'voice_unavailable',
      title: 'Voice Temporarily Unavailable',
      message: 'Using on-device voice synthesis',
      metadata: {
        reason: error.message,
      },
    });
  }
});

// Also detect when cloud TTS provider is degraded
const cloudTtsProvider = new GoogleCloudTTS();
cloudTtsProvider.on('degraded', () => {
  publishEvent({
    type: 'artifact',
    artifact_type: 'voice_unavailable',
    title: 'Voice Quality Degraded',
    message: 'Switching to on-device voice',
  });
});
```

### 5. UI Indicator (Optional)

Show user which voice mode is active:

**lib/widgets/voice_mode_indicator.dart:**
```dart
class VoiceModeIndicator extends StatelessWidget {
  final VoiceMode mode;
  
  @override
  Widget build(BuildContext context) {
    if (mode == VoiceMode.cloudTts) {
      return SizedBox.shrink(); // Hide when normal
    }
    
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: Colors.orange.withOpacity(0.2),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.offline_bolt, size: 16, color: Colors.orange),
          SizedBox(width: 4),
          Text(
            'Local Voice',
            style: TextStyle(fontSize: 12, color: Colors.orange[700]),
          ),
        ],
      ),
    );
  }
}
```

## Testing

### Unit Tests

**test/services/voice_fallback_controller_test.dart:**
```dart
void main() {
  late VoiceFallbackController controller;
  late MockLocalPiperTTS mockTts;
  late MockAudioOutput mockAudio;
  
  setUp(() {
    mockTts = MockLocalPiperTTS();
    mockAudio = MockAudioOutput();
    controller = VoiceFallbackController(
      localTts: mockTts,
      audioOutput: mockAudio,
    );
  });
  
  test('should trigger fallback on explicit artifact', () async {
    controller.onVoiceUnavailableArtifact();
    
    expect(controller.mode, VoiceMode.localFallback);
  });
  
  test('should trigger fallback on audio timeout', () async {
    // Receive transcript
    controller.onTranscriptDelta('Hello');
    
    // Wait for watchdog timeout
    await Future.delayed(Duration(seconds: 3));
    
    expect(controller.mode, VoiceMode.localFallback);
  });
  
  test('should NOT trigger fallback if audio is flowing', () async {
    // Receive transcript
    controller.onTranscriptDelta('Hello');
    
    // Simulate audio samples arriving
    controller.onAudioSample();
    
    // Wait
    await Future.delayed(Duration(seconds: 3));
    
    expect(controller.mode, VoiceMode.cloudTts);
  });
  
  test('should switch back to cloud when audio resumes', () async {
    // Trigger fallback
    controller.onVoiceUnavailableArtifact();
    expect(controller.mode, VoiceMode.localFallback);
    
    // Audio resumes
    controller.onAudioSample();
    
    expect(controller.mode, VoiceMode.cloudTts);
  });
}
```

### Integration Test

**integration_test/failover_test.dart:**
```dart
void main() {
  testWidgets('should fall back to local TTS when server fails', (tester) async {
    // Start app
    app.main();
    await tester.pumpAndSettle();
    
    // Simulate conversation
    await tester.tap(find.byIcon(Icons.mic));
    await tester.pumpAndSettle();
    
    // Simulate TTS failure (inject artifact)
    final gangliaService = getIt<GangliaEventService>();
    gangliaService.injectEvent(GangliaEvent(
      type: 'artifact',
      artifactType: 'voice_unavailable',
    ));
    
    await tester.pumpAndSettle();
    
    // Verify local voice indicator appears
    expect(find.text('Local Voice'), findsOneWidget);
  });
}
```

## Success Criteria

- [ ] `VoiceFallbackController` implemented and registered
- [ ] Fail-over triggers on "voice unavailable" artifact
- [ ] Fail-over triggers on audio timeout (2s)
- [ ] Transcripts successfully pipe to local TTS
- [ ] Audio resumes switch back to cloud mode
- [ ] Server-side artifact publishing implemented
- [ ] Unit tests passing
- [ ] Integration test verifies end-to-end fail-over

## Files Modified

- `lib/services/voice_fallback_controller.dart` (new file)
- `lib/services/ganglia_event_service.dart` (wire controller)
- `lib/services/livekit_service.dart` (monitor audio samples)
- `lib/widgets/voice_mode_indicator.dart` (new file, optional)
- `apps/voice-agent/src/agent.ts` (add artifact publishing)
- `test/services/voice_fallback_controller_test.dart` (new file)

## Next Steps

After this task:
- Task 005: Optimize performance and battery impact
- Task 006: Coordinate with offline mode (Epic 13)
