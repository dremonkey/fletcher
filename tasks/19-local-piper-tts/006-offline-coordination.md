# Task 006: Offline Mode & Edge Intelligence Coordination

**Epic:** 19 - Local Piper TTS Integration  
**Status:** 📋 Backlog  
**Depends on:** 004 (Fail-Over Pipeline), Epic 13 (Edge Intelligence)

## Objective

Ensure local Piper TTS works seamlessly in **full offline mode** and coordinates properly with other edge intelligence features (local VAD, wake word, etc.).

## Vision: Full Edge Stack

### Phase 1 (Current Epic): Local TTS Fallback
```
Cloud STT → OpenClaw (cloud) → Cloud TTS
                               └─ [FALLBACK] Local Piper
```

### Phase 2 (Future): Full Offline Voice Stack
```
Local VAD → Local STT → OpenClaw (cached) → Local Piper
```

This task focuses on **Phase 1** while ensuring compatibility with **Phase 2** (Epic 13).

## Offline Mode Detection

### Network Connectivity Monitoring

Create a service to detect offline state:

**lib/services/connectivity_service.dart:**
```dart
import 'package:connectivity_plus/connectivity_plus.dart';

enum ConnectivityState {
  online,
  offline,
  degraded,  // Poor connection quality
}

class ConnectivityService extends ChangeNotifier {
  ConnectivityState _state = ConnectivityState.online;
  ConnectivityState get state => _state;
  
  late StreamSubscription<ConnectivityResult> _subscription;
  
  void initialize() {
    // Monitor connectivity changes
    _subscription = Connectivity().onConnectivityChanged.listen((result) {
      _updateState(result);
    });
    
    // Check initial state
    Connectivity().checkConnectivity().then(_updateState);
  }
  
  void _updateState(ConnectivityResult result) {
    switch (result) {
      case ConnectivityResult.none:
        _state = ConnectivityState.offline;
        break;
      case ConnectivityResult.mobile:
      case ConnectivityResult.wifi:
      case ConnectivityResult.ethernet:
        _state = ConnectivityState.online;
        break;
      default:
        _state = ConnectivityState.degraded;
    }
    
    notifyListeners();
  }
  
  @override
  void dispose() {
    _subscription.cancel();
    super.dispose();
  }
}
```

### Integrate with VoiceFallbackController

**lib/services/voice_fallback_controller.dart:**
```dart
class VoiceFallbackController {
  final ConnectivityService _connectivity;
  
  VoiceFallbackController({
    required ConnectivityService connectivity,
    // ...
  }) : _connectivity = connectivity {
    // Listen for offline mode
    _connectivity.addListener(_onConnectivityChanged);
  }
  
  void _onConnectivityChanged() {
    if (_connectivity.state == ConnectivityState.offline) {
      debugPrint('VoiceFallback: Offline mode detected, forcing local TTS');
      _switchToLocalTts();
    }
  }
}
```

## Voice Consistency

### Goal: Seamless Transition

Users should **not notice** when the voice switches from cloud → local. The experience should feel like a single, consistent voice assistant.

### Strategies

1. **Use Same Voice Model**
   - Server Piper: `en_US-lessac-medium`
   - Local Piper: `en_US-lessac-medium` (exact match)

2. **Normalize Prosody**
   - Match speaking speed (1.0x)
   - Match volume levels
   - Maintain consistent sentence pacing

3. **Audio Crossfade (Optional)**
   ```dart
   class AudioOutputService {
     Future<void> crossfade({
       required AudioSource from,
       required AudioSource to,
       Duration duration = const Duration(milliseconds: 200),
     }) async {
       // Fade out cloud audio
       await from.setVolume(0, duration: duration);
       
       // Simultaneously fade in local audio
       await to.setVolume(1, duration: duration);
     }
   }
   ```

### A/B Testing

Conduct blind listening tests:
- Play 10 clips: 5 cloud TTS, 5 local Piper
- Ask users: "Can you tell which is which?"
- Target: <60% accuracy (indistinguishable)

## System Prompt Optimization

Update OpenClaw prompts to account for local TTS constraints:

**packages/livekit-agent-ganglia/src/prompts.ts:**
```typescript
const systemPrompt = `
You are a helpful voice assistant. Your responses will be spoken aloud.

Voice Output Guidelines:
- Keep responses concise (1-3 sentences when possible)
- Avoid complex punctuation that affects TTS prosody
- Use natural, conversational language
- When using local voice synthesis, prefer shorter utterances

${offlineMode ? 'NOTE: User is currently offline. Local voice synthesis active.' : ''}
`;
```

**Adaptive Response Length:**
```typescript
function getMaxResponseLength(voiceMode: 'cloud' | 'local'): number {
  return voiceMode === 'cloud' ? 500 : 200; // Chars
}
```

## Coordination with Epic 13 (Edge Intelligence)

### Task Dependencies

| Epic 13 Task | Epic 19 Coordination |
|--------------|---------------------|
| **003: Integrated Wake Word** | Local TTS should work when wake word triggers (no cloud) |
| **004: Local VAD** | Voice activity detection triggers local TTS in offline mode |
| **005: Offline Mode** | Full offline stack: Local VAD → (future STT) → Local TTS |

### Future: Local STT Integration

When local STT is available (Whisper.cpp or similar):

```
[Offline Stack]
  User speaks
    ↓
  Local VAD detects speech
    ↓
  Local Whisper STT transcribes
    ↓
  OpenClaw (cached responses or local LLM)
    ↓
  Local Piper TTS speaks
    ↓
  User hears response
```

**This task lays the foundation** by ensuring Local Piper is production-ready.

## User Experience (UX)

### Offline Mode Indicator

Show when the app is in full offline mode:

**lib/widgets/offline_mode_banner.dart:**
```dart
class OfflineModeBanner extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Consumer<ConnectivityService>(
      builder: (context, connectivity, child) {
        if (connectivity.state != ConnectivityState.offline) {
          return SizedBox.shrink();
        }
        
        return Container(
          width: double.infinity,
          padding: EdgeInsets.all(8),
          color: Colors.orange.shade100,
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.cloud_off, size: 16, color: Colors.orange.shade700),
              SizedBox(width: 8),
              Text(
                'Offline Mode - Using local voice',
                style: TextStyle(
                  fontSize: 14,
                  color: Colors.orange.shade700,
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}
```

### Graceful Degradation

When offline, disable features that require network:
- Cloud STT (keep local VAD + manual typing)
- Cloud knowledge queries (show cached responses only)
- Voice customization (use default local voice only)

**lib/services/feature_availability_service.dart:**
```dart
class FeatureAvailabilityService {
  final ConnectivityService _connectivity;
  
  bool get canUseCloudStt => _connectivity.state == ConnectivityState.online;
  bool get canUseCloudTts => _connectivity.state == ConnectivityState.online;
  bool get canQueryKnowledge => _connectivity.state == ConnectivityState.online;
  
  bool get canUseLocalTts => true; // Always available
  bool get canUseLocalVad => true; // Always available (Epic 13)
}
```

## Testing Offline Mode

### Integration Test

**integration_test/offline_mode_test.dart:**
```dart
void main() {
  testWidgets('full offline mode works', (tester) async {
    // Start app
    app.main();
    await tester.pumpAndSettle();
    
    // Simulate offline mode
    final connectivity = getIt<ConnectivityService>();
    connectivity._updateState(ConnectivityResult.none);
    await tester.pump();
    
    // Verify offline banner appears
    expect(find.text('Offline Mode'), findsOneWidget);
    
    // Attempt to speak (should use local TTS)
    await tester.tap(find.byIcon(Icons.mic));
    await tester.pumpAndSettle();
    
    // Inject transcript (simulating cached response)
    final ganglia = getIt<GangliaEventService>();
    ganglia.injectEvent(GangliaEvent(
      type: 'transcript_delta',
      delta: 'Hello, I am running offline.',
    ));
    
    await tester.pumpAndSettle();
    
    // Verify local TTS was triggered
    final voiceFallback = getIt<VoiceFallbackController>();
    expect(voiceFallback.mode, VoiceMode.localFallback);
  });
}
```

### Manual Testing Checklist

- [ ] Turn on airplane mode
- [ ] Open Fletcher app
- [ ] Verify "Offline Mode" banner appears
- [ ] Type a message (STT unavailable)
- [ ] Verify response arrives (cached or error)
- [ ] Verify local Piper voice speaks the response
- [ ] Turn off airplane mode
- [ ] Verify banner disappears
- [ ] Verify cloud TTS resumes on next turn

## Documentation Updates

### User-Facing Docs

**docs/features/offline-mode.md:**
```markdown
# Offline Mode

Fletcher supports **limited offline functionality** when network connectivity is unavailable.

## What Works Offline

✅ Local voice synthesis (Piper TTS)
✅ Voice activity detection (VAD)
✅ Cached conversation history
✅ Manual text input

## What Requires Network

❌ Cloud speech recognition (STT)
❌ Real-time OpenClaw responses
❌ Knowledge base queries
❌ Cloud voice customization

## Future: Full Offline Stack

We are working on enabling **full offline voice conversations** using local STT and LLM caching. Stay tuned!
```

### Developer Docs

**docs/architecture/offline-stack.md:**
```markdown
# Offline Architecture

## Current State (Epic 19)

- Local Piper TTS as fallback when cloud TTS fails
- Requires network for STT and LLM inference

## Future State (Epic 13 + 19)

- Local VAD (Silero VAD ONNX)
- Local STT (Whisper.cpp)
- Local LLM (cached responses or Gemma 2B)
- Local TTS (Piper ONNX)

## Trade-offs

- **Latency:** Local stack is slower than cloud (acceptable for offline)
- **Quality:** Local models slightly lower quality than cloud
- **Privacy:** 100% on-device, zero telemetry
```

## Success Criteria

- [ ] `ConnectivityService` detects offline mode
- [ ] `VoiceFallbackController` forces local TTS when offline
- [ ] Offline mode banner appears in UI
- [ ] Voice consistency validated (blind listening test <60% accuracy)
- [ ] System prompts optimized for local TTS
- [ ] Integration test validates offline functionality
- [ ] User docs updated
- [ ] Developer docs updated

## Files Modified

- `lib/services/connectivity_service.dart` (new file)
- `lib/services/voice_fallback_controller.dart` (add offline detection)
- `lib/widgets/offline_mode_banner.dart` (new file)
- `lib/services/feature_availability_service.dart` (new file)
- `integration_test/offline_mode_test.dart` (new file)
- `docs/features/offline-mode.md` (new file)
- `docs/architecture/offline-stack.md` (new file)

## Next Steps

After Epic 19 completion:
- Epic 13 Task 004: Local VAD evaluation
- Epic 13 Task 005: Offline mode coordination
- Future: Local STT (Whisper.cpp) integration
