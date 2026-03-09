# Task 003: Piper Model Selection & Bundling Strategy

**Epic:** 19 - Local Piper TTS Integration  
**Status:** 📋 Backlog  
**Depends on:** 001 (Technical Spec), 002 (Sherpa-ONNX Integration)

## Objective

Select the optimal Piper voice model for on-device synthesis and implement the bundling/delivery strategy.

## Model Selection Criteria

### Primary Constraints

1. **Voice Consistency:** Should match current server-side Piper voice (`en_US-lessac-medium`)
2. **Quality:** Acceptable voice quality for "Pro" tier users
3. **Size:** Minimize APK size impact (<25MB)
4. **Performance:** Fast enough for real-time synthesis on mid-range devices

### Model Variants

Piper offers three quality tiers for each voice:

| Model | Size | Quality | Inference Speed |
|-------|------|---------|-----------------|
| `en_US-lessac-low` | ~5MB | Acceptable | Fast |
| `en_US-lessac-medium` | ~18MB | Good | Medium |
| `en_US-lessac-high` | ~63MB | Excellent | Slow |

**Recommendation:** Start with `medium` quality to match server-side voice. Evaluate `low` quality if performance or size becomes an issue.

## Benchmarking Plan

### Test Devices

- **High-end:** Pixel 7 Pro, iPhone 14 Pro
- **Mid-range:** Pixel 6a, iPhone 12
- **Low-end:** Budget Android (Snapdragon 6-series)

### Metrics to Collect

```dart
class SynthesisBenchmark {
  final String modelName;
  final String text;
  final int textLength;
  final Duration synthesisTime;
  final int audioSamples;
  final double realTimeRatio; // synthesis_time / audio_duration
  final int memoryUsageMB;
  
  // Target: realTimeRatio < 0.5 (faster than real-time)
  // Target: memoryUsageMB < 100
}
```

### Test Cases

1. **Short utterance** (1 sentence, ~10 words)
2. **Medium utterance** (2-3 sentences, ~30 words)
3. **Long utterance** (paragraph, ~100 words)

**Example:**
```dart
final testCases = [
  'Hello, how can I help you today?',
  'The weather in San Francisco is sunny with a high of 72 degrees. It will be a beautiful day for outdoor activities.',
  'Here is a longer response that contains multiple sentences with various punctuation marks. This will test the synthesis performance on more complex text inputs. The model should handle this gracefully without stuttering or excessive latency.',
];
```

## Model Download & Preparation

### 1. Download from Piper Repository

```bash
# Download medium quality model
wget https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx
wget https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json
wget https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/MODEL_CARD

# Get tokens file (shared across models)
wget https://github.com/rhasspy/piper/raw/master/src/python/piper_train/vits/espeak/tokens.txt
```

### 2. Validate Model

```bash
# Test synthesis with piper CLI
echo "Hello world" | piper --model en_US-lessac-medium.onnx --output_file test.wav
aplay test.wav  # Verify audio quality
```

### 3. Place in Assets

```
flutter_app/
  assets/
    models/
      piper/
        en_US-lessac-medium.onnx        (~18MB)
        en_US-lessac-medium.onnx.json   (~2KB)
        tokens.txt                       (~50KB)
```

## Bundling Strategy

### Option A: APK Bundle (Recommended for MVP)

**Pros:**
- Zero latency—model available immediately on first launch
- Works offline from day one
- No download UI/error handling needed

**Cons:**
- Increases APK size by ~20MB
- All users download model even if they never use local TTS

**Implementation:**
```yaml
# pubspec.yaml
flutter:
  assets:
    - assets/models/piper/
```

### Option B: Download on First Use (Future Optimization)

**Pros:**
- Smaller APK (~100KB vs. ~20MB)
- Users only download if they need local TTS

**Cons:**
- Requires network for first local TTS usage (defeats "offline" purpose)
- Needs download UI, progress indicators, retry logic
- More complex error handling

**Implementation (Future):**
```dart
class ModelDownloader {
  static const modelUrl = 'https://cdn.fletcher.app/models/piper/en_US-lessac-medium.onnx';
  
  Future<void> downloadModelIfNeeded() async {
    final modelPath = await _getModelPath();
    if (await File(modelPath).exists()) return;
    
    // Show download progress
    await _downloadWithProgress(modelUrl, modelPath);
  }
}
```

**Decision:** Use Option A (APK bundle) for MVP. Migrate to Option B if app store reviewers complain about size.

## Model Versioning

### Version Management

Models should be versioned to support OTA updates without full app update:

```dart
class PiperModelMetadata {
  final String version = '1.0.0';  // Model version
  final String voice = 'lessac';
  final String quality = 'medium';
  final int sampleRate = 22050;
  final String language = 'en_US';
}
```

### Future: OTA Model Updates

```dart
class ModelUpdateService {
  Future<void> checkForUpdates() async {
    final latestVersion = await _fetchLatestModelVersion();
    final currentVersion = await _getCurrentModelVersion();
    
    if (latestVersion > currentVersion) {
      await _downloadAndInstallUpdate(latestVersion);
    }
  }
}
```

**Note:** Implement in Phase 2 after MVP is stable.

## Multi-Language Support (Future)

For international expansion, we'll need to bundle multiple language models:

```
assets/models/piper/
  en_US-lessac-medium.onnx    (~18MB)
  es_ES-davefx-medium.onnx    (~18MB)
  fr_FR-siwis-medium.onnx     (~18MB)
  ...
```

**Strategy:** Download language packs on-demand based on user locale.

## Testing Plan

### Benchmark Script

```dart
// tools/benchmark_piper_models.dart

Future<void> main() async {
  final models = [
    'en_US-lessac-low',
    'en_US-lessac-medium',
    // 'en_US-lessac-high',  // Too large for mobile
  ];
  
  final testCases = [
    'Hello, how are you?',
    'The quick brown fox jumps over the lazy dog.',
    // ... more test cases
  ];
  
  for (final model in models) {
    print('Benchmarking $model...');
    
    final tts = LocalPiperTTS();
    await tts.loadModel(model);
    
    for (final text in testCases) {
      final start = DateTime.now();
      final audio = await tts.synthesize(text);
      final duration = DateTime.now().difference(start);
      
      final audioLengthSec = audio.samples.length / audio.sampleRate;
      final realTimeRatio = duration.inMilliseconds / (audioLengthSec * 1000);
      
      print('  Text: "$text"');
      print('  Synthesis time: ${duration.inMilliseconds}ms');
      print('  Real-time ratio: ${realTimeRatio.toStringAsFixed(2)}x');
      print('');
    }
  }
}
```

### Quality Assessment

Conduct blind listening tests:
1. Play 10 samples: 5 from cloud TTS, 5 from local Piper
2. Ask users to rate quality 1-5
3. Target: Local Piper scores ≥4/5 average

## Success Criteria

- [ ] `en_US-lessac-medium` model downloaded and validated
- [ ] Model files bundled in `assets/models/piper/`
- [ ] Benchmark results show real-time ratio <0.5 on mid-range devices
- [ ] Memory usage <100MB during synthesis
- [ ] Quality assessment shows ≥4/5 rating
- [ ] APK size increase <25MB

## Files Modified

- `assets/models/piper/` (new model files)
- `pubspec.yaml` (add asset paths)
- `lib/services/local_piper_tts.dart` (update model paths)

## Next Steps

After this task:
- Task 004: Wire local TTS into voice pipeline as fallback
- Task 005: Optimize performance and battery impact
