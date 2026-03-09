# Task 001: Local Piper TTS Technical Specification

**Epic:** 19 - Local Piper TTS Integration  
**Status:** 📋 Planning  
**Priority:** High (COGS Reduction + Reliability)

## Objective

Design and implement on-device Piper TTS in the Fletcher mobile app as a **fail-over reliability layer** that eliminates voice delivery failures and drops voice-out COGS to $0.

## Problem Statement

### Current Pain Points

1. **Silent Delivery (BUG-030, BUG-034):** When server-side TTS fails (Gemini rate limits, network timeouts), the response text arrives via the data channel but no audio is generated—the user sees text but hears nothing.

2. **COGS Pressure:** Cloud TTS (Google/ElevenLabs) costs ~$0.135/min, making "unlimited voice" economically impossible at current pricing ($4.99/mo target).

3. **Network Dependency:** TTS requires a round-trip to the server or cloud provider, adding latency and creating a single point of failure.

### The Opportunity

**Transcripts are already arriving reliably** via the `ganglia-events` data channel topic. When server-side voice fails, we have the text—we just need to speak it locally.

## Proposed Architecture: Fail-Over Local Synthesis

### Tier 1: Cloud TTS (Primary)
- Current default: Google Cloud TTS via voice agent
- High quality, low latency when network is solid
- Cost: ~$0.135/min

### Tier 2: Server Piper (Fallback)
- Current fallback: Piper Docker sidecar
- Good quality, no cloud API dependency
- Cost: ~$0.02/min (compute only)

### Tier 3: **Local Piper (NEW - Ultimate Fallback)**
- On-device ONNX inference via `sherpa-onnx`
- Triggers when Tier 1 & 2 fail OR user is offline
- Cost: **$0** (zero COGS)

## Fail-Over Flow

### Normal Operation (Cloud TTS Available)

```
1. User speaks → VAD triggers
2. STT transcribes → text sent to OpenClaw
3. OpenClaw responds → transcript deltas arrive via data channel
4. Voice agent synthesizes → LiveKit audio track plays
5. App displays transcript + plays audio
```

### Fail-Over Mode (Cloud TTS Unavailable)

```
1. User speaks → VAD triggers
2. STT transcribes → text sent to OpenClaw
3. OpenClaw responds → transcript deltas arrive via data channel
4. Voice agent detects TTS failure → sends "Voice Unavailable" artifact
5. App receives artifact → switches to LOCAL PIPER MODE
6. App pipes transcript deltas → local Piper engine → audio output
7. App displays transcript + plays LOCAL audio
```

**Key Insight:** Since transcripts are already arriving via the reliable data channel, we have everything we need to synthesize locally—no additional protocol changes required.

## Detection Logic (Mobile App)

### Trigger Conditions for Local Synthesis

The app switches to local Piper when **any** of these conditions are met:

1. **Explicit "Voice Unavailable" Artifact**
   - Voice agent sends `{ type: 'artifact', artifact_type: 'voice_unavailable' }`
   - Indicates server-side TTS has failed

2. **Audio Track Timeout**
   - Transcript deltas arriving BUT no audio track samples for >2 seconds
   - Indicates silent delivery (BUG-030)

3. **Network Degradation**
   - LiveKit connection quality drops to "poor"
   - Proactive switch to local synthesis before failure

4. **Offline Mode**
   - No network connectivity
   - All TTS must be local

## Implementation Design

### Phase 1: Core Integration (Tasks 002-003)

#### 002: Sherpa-ONNX Flutter Integration

**Goal:** Get Piper models running in the Flutter app.

**Approach:**
- Use [`sherpa-onnx` Flutter package](https://pub.dev/packages/sherpa_onnx)
- Alternative: Platform channels with native `onnxruntime` (more control, more work)

**Key Components:**
```dart
class LocalPiperTTS {
  late OfflineTts _tts;
  
  Future<void> initialize() async {
    // Load Piper model from assets
    final modelPath = await _extractModelFromAssets();
    _tts = await OfflineTts.create(
      model: OfflineTtsModelConfig(
        vits: OfflineTtsVitsModelConfig(
          model: '$modelPath/en_US-lessac-medium.onnx',
          tokens: '$modelPath/tokens.txt',
          dataDir: '$modelPath/',
        ),
      ),
    );
  }
  
  Stream<List<int>> synthesize(String text) async* {
    // Generate audio samples
    final audio = _tts.generate(text: text, speed: 1.0, speakerId: 0);
    yield audio.samples; // Int16 PCM samples
  }
}
```

**Testing:**
- Unit test: Load model, synthesize "Hello world", verify PCM output
- Integration test: Play synthesized audio via platform audio player

#### 003: Model Selection & Bundling

**Goal:** Choose optimal model and delivery strategy.

**Model Selection:**
- Target: `en_US-lessac-medium` (matches current server Piper voice)
- Quality: Medium (balance quality vs. size)
- Size: ~15-20MB (model + vocoder + tokens)

**Bundling Strategy:**
```
Option A: APK Bundle (Recommended for MVP)
  ✅ Zero latency — model available immediately
  ✅ Works offline from first launch
  ❌ Increases APK size by ~20MB
  
Option B: Download on First Use
  ✅ Smaller APK
  ❌ Requires network for first TTS
  ❌ Increases complexity (download UI, progress, retry)
  
Decision: Start with Option A (APK bundle), migrate to B if app size becomes an issue.
```

**Asset Structure:**
```
assets/models/piper/
  ├── en_US-lessac-medium.onnx      (~18MB)
  ├── en_US-lessac-medium.onnx.json (~2KB config)
  └── tokens.txt                     (~50KB)
```

### Phase 2: Pipeline Integration (Task 004)

#### 004: Fail-Over Pipeline & Data Channel Bridge

**Goal:** Wire local Piper into the voice pipeline as the ultimate fallback.

**Current Data Flow (Transcript Deltas):**
```
OpenClaw Gateway
  → LiveKit Data Channel (ganglia-events topic)
    → Flutter App (GangliaEventService)
      → MessageBloc (state management)
        → UI (ConversationView)
```

**New Flow (Local Synthesis):**
```
OpenClaw Gateway
  → LiveKit Data Channel (ganglia-events topic)
    → Flutter App (GangliaEventService)
      → [NEW] VoiceFallbackController
        ├─ Detects "voice unavailable" or timeout
        ├─ Buffers incoming transcript deltas
        └─ Pipes to LocalPiperTTS
          → PCM samples → AudioOutputService
```

**Key Components:**

```dart
class VoiceFallbackController {
  final LocalPiperTTS _localTts;
  final StreamController<TranscriptDelta> _transcriptBuffer;
  bool _usingLocalTts = false;
  
  void onTranscriptDelta(TranscriptDelta delta) {
    // Always buffer deltas for potential local synthesis
    _transcriptBuffer.add(delta);
    
    if (_shouldTriggerLocalSynthesis()) {
      _switchToLocalTts();
    }
  }
  
  bool _shouldTriggerLocalSynthesis() {
    // Trigger logic:
    // 1. Explicit artifact
    if (_receivedVoiceUnavailableArtifact) return true;
    
    // 2. Audio track timeout
    final timeSinceLastAudio = DateTime.now().difference(_lastAudioSample);
    if (_transcriptBuffer.isNotEmpty && timeSinceLastAudio > Duration(seconds: 2)) {
      return true;
    }
    
    // 3. Offline mode
    if (!_isOnline) return true;
    
    return false;
  }
  
  void _switchToLocalTts() async {
    if (_usingLocalTts) return;
    
    _usingLocalTts = true;
    
    // Flush buffered transcripts to local TTS
    final fullText = _transcriptBuffer.join();
    await for (final samples in _localTts.synthesize(fullText)) {
      _audioOutputService.play(samples);
    }
    
    // Continue streaming future deltas
    _transcriptBuffer.stream.listen((delta) {
      _localTts.synthesize(delta.text).listen((samples) {
        _audioOutputService.play(samples);
      });
    });
  }
}
```

**Server-Side Changes (Voice Agent):**

Add explicit "Voice Unavailable" artifact when TTS fails:

```typescript
// apps/voice-agent/src/agent.ts

session.on(voice.AgentSessionEventTypes.Error, (ev) => {
  if (ev.error.message.includes('TTS') || ev.error.message.includes('synthesis')) {
    // Publish explicit fallback signal
    publishEvent({
      type: 'artifact',
      artifact_type: 'voice_unavailable',
      title: 'Voice Unavailable',
      message: 'Using on-device voice synthesis',
    });
  }
});
```

### Phase 3: Optimization (Task 005)

#### 005: Performance & Battery Optimization

**Goal:** Ensure local TTS is production-ready for real-world usage.

**Benchmarks (Target Devices):**
- Pixel 6/7 (high-end Android)
- Mid-range Android (Snapdragon 7-series)
- iPhone 12+ (iOS)

**Metrics:**
- **Latency:** <500ms for 1-2 sentence utterance
- **Memory:** <100MB peak during synthesis
- **Battery:** <5% drain over 30min continuous TTS

**Optimization Strategies:**

1. **ONNX Runtime Acceleration**
   - Enable NNAPI delegate (Android neural hardware)
   - CoreML delegate (iOS)

2. **Model Quantization**
   - INT8 quantization if FP32 is too slow
   - Trade slight quality loss for 4x speedup

3. **Streaming Synthesis**
   - Generate audio in chunks (don't wait for full text)
   - Reduces perceived latency

4. **Model Caching**
   - Keep model loaded in memory during active session
   - Unload after 5min idle to free memory

### Phase 4: Coordination (Task 006)

#### 006: Offline Mode & Edge Intelligence Coordination

**Goal:** Ensure local TTS works seamlessly with other offline features.

**Dependencies:**
- Epic 13 (Edge Intelligence): Local VAD, Wake Word
- Epic 9 (Connectivity): Offline mode detection

**Coordination Points:**

1. **Full Offline Stack:**
   ```
   Local VAD → Local STT (future) → OpenClaw (cached) → Local TTS
   ```

2. **Voice Consistency:**
   - Local Piper voice should match server Piper voice
   - User shouldn't notice the switch

3. **System Prompts:**
   - Update OpenClaw prompts to acknowledge local TTS constraints
   - E.g., "Keep responses concise when using local voice"

## Migration Strategy

### Rollout Plan

**Week 1-2: Discovery & Prototyping (Task 001)**
- Spike: Get sherpa-onnx working in Flutter
- Benchmark inference performance
- Select optimal model

**Week 3-4: Core Integration (Tasks 002-003)**
- Integrate sherpa-onnx package
- Bundle Piper model in APK
- Unit tests for synthesis

**Week 5-6: Pipeline Integration (Task 004)**
- Implement VoiceFallbackController
- Wire data channel → local TTS bridge
- Add server-side "voice unavailable" artifact

**Week 7: Optimization (Task 005)**
- Performance benchmarking
- Enable NNX acceleration
- Battery impact testing

**Week 8: Field Testing**
- Beta rollout to test users
- Monitor fallback trigger rate
- Collect quality feedback

### Feature Flags

```dart
class FeatureFlags {
  static const bool enableLocalPiperTts = true; // Master toggle
  static const bool preferLocalTts = false;     // Force local (testing)
  static const bool logFallbackEvents = true;   // Analytics
}
```

## Success Metrics

### Primary Metrics

1. **Zero Silent Delivery:** 0% of responses result in "text but no audio"
2. **COGS Reduction:** Voice-out cost drops to $0 for local synthesis sessions
3. **Offline Capability:** 100% voice synthesis success rate in offline mode

### Secondary Metrics

1. **Fallback Trigger Rate:** <5% of sessions trigger local TTS (cloud should be primary)
2. **Synthesis Latency:** <500ms local TTS latency (vs. ~200ms cloud TTS)
3. **Quality Score:** User-reported voice quality ≥4/5 for local Piper

## Open Questions

1. **Model Updates:** How do we ship new Piper voices without full app update?
   - Possible: OTA model downloads, versioned model cache

2. **Multi-Language:** Should we bundle multiple language models?
   - Phase 1: English only, expand later

3. **Voice Customization:** Should users choose from multiple local voices?
   - Phase 1: Single default voice, expand later

## References

- [Sherpa-ONNX Flutter Package](https://pub.dev/packages/sherpa_onnx)
- [Piper TTS Models](https://github.com/rhasspy/piper/blob/master/VOICES.md)
- [ONNX Runtime Mobile](https://onnxruntime.ai/docs/tutorials/mobile/)
- [Task 13-031: Local PiperTTS Discovery](../13-edge-intelligence/031-local-piper-tts.md)
- [BUG-030: Unidirectional Blackout](../../docs/field-tests/20260307-buglog.md)
- [BUG-034: Silent Session Drop](../../docs/field-tests/20260307-buglog.md)

## Next Steps

1. **Spike (Task 001):** Build minimal Flutter app with sherpa-onnx, verify Piper synthesis works
2. **Model Selection (Task 003):** Benchmark `low`, `medium`, `high` quality models
3. **Integration (Task 002):** Add sherpa-onnx to Fletcher app, create LocalPiperTTS service
4. **Pipeline (Task 004):** Implement VoiceFallbackController and data channel bridge
