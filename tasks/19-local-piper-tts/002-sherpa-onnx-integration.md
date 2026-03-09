# Task 002: Sherpa-ONNX Flutter Integration

**Epic:** 19 - Local Piper TTS Integration
**Status:** 📋 Backlog (Ready for Prototyping)
**Depends on:** 001 (Technical Spec & Discovery) -- COMPLETE

## Objective

Integrate the `sherpa-onnx` Flutter package into the Fletcher mobile app to enable on-device Piper TTS inference.

## Discovery Findings (from Task 001)

Key facts validated by research:

- **Package:** `sherpa_onnx` v1.12.28 (actively maintained, 9.1k weekly downloads)
- **Android min SDK:** 23 (Fletcher currently targets higher)
- **iOS min version:** 13.0
- **Model size:** 63 MB (NOT 18 MB as originally estimated)
- **espeak-ng-data:** Required for phonemization (~3-5 MB), shared across Piper languages
- **NNAPI:** Does NOT work for TTS (crashes, Issue #958) -- must use CPU provider
- **API:** Synchronous `generate()` -- must run on isolate to avoid UI blocking
- **Memory:** Peak ~500 MB during inference, settling to ~100-200 MB

## Revised Requirements

- [x] ~~Research sherpa-onnx API and Piper compatibility~~ (Done in Task 001)
- [ ] Add `sherpa_onnx` package dependency to Flutter project
- [ ] Implement platform-specific setup (Android/iOS)
- [ ] Download and prepare model files (ONNX + espeak-ng-data + tokens)
- [ ] Create `LocalPiperTTS` service wrapper with isolate-based synthesis
- [ ] Verify model loading and basic synthesis on Android device
- [ ] Verify audio output (PCM samples playable)

## Implementation Plan

### 1. Add Dependencies

**pubspec.yaml:**
```yaml
dependencies:
  sherpa_onnx: ^1.12.28
  path_provider: ^2.1.0  # For model file paths
```

### 2. Platform Setup

**Android (android/app/build.gradle):**
```gradle
android {
    defaultConfig {
        minSdkVersion 24  // sherpa-onnx requires min 23, Fletcher uses 24+
        ndk {
            abiFilters 'arm64-v8a'  // Primary target
        }
    }
}
```

**iOS (ios/Podfile):**
```ruby
platform :ios, '13.0'  # sherpa-onnx requirement
```

### 3. Prepare Model Files

Download from sherpa-onnx releases and Hugging Face:

```bash
# espeak-ng-data (shared by all Piper models)
wget https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/espeak-ng-data.tar.bz2
tar xf espeak-ng-data.tar.bz2

# Model files (already in repo at models/piper/)
# en_US-lessac-medium.onnx (63 MB)
# en_US-lessac-medium.onnx.json (5 KB)

# tokens.txt -- extract from JSON config or download from sherpa-onnx
```

**Note:** For the prototype, model files should be placed on the device filesystem (not bundled in APK). Use `adb push` for initial testing.

### 4. Create LocalPiperTTS Service

**Key Design Decisions:**
- Synthesis runs on a Dart `Isolate` to avoid blocking the UI thread
- Model loaded once per session, freed after 5 minutes of idle
- CPU-only provider (NNAPI crashes for TTS)
- Match server-side Piper params: noise_scale=0.667, noise_w=0.8, length_scale=1.0

**lib/services/local_piper_tts.dart:**
```dart
import 'dart:io';
import 'dart:isolate';
import 'package:sherpa_onnx/sherpa_onnx.dart';
import 'package:path_provider/path_provider.dart';

class LocalPiperTTS {
  OfflineTts? _tts;
  bool _initialized = false;
  Timer? _unloadTimer;

  bool get isInitialized => _initialized;
  int get sampleRate => _tts?.sampleRate ?? 22050;

  /// Initialize the Piper TTS engine
  ///
  /// [modelDir] must contain:
  ///   - en_US-lessac-medium.onnx
  ///   - tokens.txt
  ///   - espeak-ng-data/ (directory)
  Future<void> initialize(String modelDir) async {
    if (_initialized) return;

    final config = OfflineTtsConfig(
      model: OfflineTtsModelConfig(
        vits: OfflineTtsVitsModelConfig(
          model: '$modelDir/en_US-lessac-medium.onnx',
          tokens: '$modelDir/tokens.txt',
          dataDir: '$modelDir/espeak-ng-data',
          // Match server-side Piper params from models/piper/*.onnx.json
          noiseScale: 0.667,
          noiseScaleW: 0.8,
          lengthScale: 1.0,
        ),
        numThreads: 2,
        provider: 'cpu',  // NNAPI crashes for TTS (sherpa-onnx #958)
      ),
    );

    _tts = OfflineTts(config);
    _initialized = true;
    _resetUnloadTimer();
  }

  /// Synthesize text to PCM audio (Float32, 22050 Hz mono)
  ///
  /// WARNING: This is a blocking call. Run on an isolate for UI safety.
  GeneratedAudio? synthesize(String text, {double speed = 1.0}) {
    if (!_initialized || _tts == null) return null;

    _resetUnloadTimer();
    return _tts!.generate(text: text, sid: 0, speed: speed);
  }

  /// Reset the auto-unload timer (5 minutes idle)
  void _resetUnloadTimer() {
    _unloadTimer?.cancel();
    _unloadTimer = Timer(const Duration(minutes: 5), () {
      dispose();
    });
  }

  /// Free native resources
  void dispose() {
    _unloadTimer?.cancel();
    _tts?.free();
    _tts = null;
    _initialized = false;
  }
}
```

### 5. Model File Management

For the prototype, model files will be pushed to the device via adb.
For production (Task 003), implement download-on-first-use.

```dart
/// Check if model files exist on device
Future<bool> isModelAvailable() async {
  final appDir = await getApplicationDocumentsDirectory();
  final modelDir = Directory('${appDir.path}/models/piper');
  final modelFile = File('${modelDir.path}/en_US-lessac-medium.onnx');
  return modelFile.existsSync();
}
```

## Testing

### Manual Test (Prototype)

1. Push model files to device:
   ```bash
   adb push models/piper/ /data/local/tmp/piper/
   adb push espeak-ng-data/ /data/local/tmp/piper/espeak-ng-data/
   ```

2. In the prototype app, point to `/data/local/tmp/piper/` as the model directory.

3. Synthesize "Hello, how are you today?" and verify:
   - PCM samples are returned (non-empty Float32List)
   - Sample rate is 22050
   - Audio sounds intelligible when played

### Unit Test (Post-Prototype)

```dart
test('should synthesize simple text', () async {
  final tts = LocalPiperTTS();
  await tts.initialize(modelDir);

  final audio = tts.synthesize('Hello world');

  expect(audio, isNotNull);
  expect(audio!.samples.isNotEmpty, true);
  expect(audio.sampleRate, 22050);

  tts.dispose();
});
```

## Prototype Scope

For the initial spike, the goal is MINIMAL:
1. Get sherpa-onnx building in the Flutter project
2. Load the Piper model on an Android device
3. Synthesize a test sentence to PCM
4. Play the PCM audio (even if just saving to a WAV file)

This is NOT production integration. Pipeline wiring comes in Task 004.

## Success Criteria

- [ ] `sherpa-onnx` package integrated and building on Android
- [ ] `LocalPiperTTS` service loads Piper model successfully
- [ ] `synthesize()` method generates valid PCM audio samples
- [ ] Audio is audible and intelligible
- [ ] Synthesis completes in <2 seconds for a short sentence on test device
- [ ] No crashes or memory leaks during basic usage

## Why sherpa-onnx Over Piper-Specific Flutter Packages

Three Piper-specific Flutter packages were evaluated (see Task 001 Section 7 for full details). None are production-ready alternatives to sherpa-onnx:

### `piper_tts` (v0.0.1, pub.dev)

- **Publisher:** Mobile-Artificial-Intelligence
- **API:** `Piper.modelPath = '...'; await Piper.generateSpeech(text);` -- returns `Future<File>`
- **Native backend:** babylon.cpp (C/C++ reimplementation with DeepPhonemizer, not espeak-ng)
- **Platforms:** Android (broken per changelog), Linux, Windows -- **no iOS**
- **Status:** ABANDONED -- 23 months since last update, GitHub repo returns 404, changelog says "Android not working yet"
- **Verdict:** Dead project. Clean API design but unusable.

### `piper_tts_plugin` (v0.0.2, pub.dev)

- **Publisher:** dev-6768
- **API:** `loadViaVoicePack(PiperVoicePack.norman); synthesizeToFile(text, path);`
- **Native backend:** ONNX Runtime via `onnxruntime` Flutter package + `piper_phonemizer_plugin`
- **Platforms:** Android, Windows -- **no iOS** (planned)
- **Status:** EARLY DEVELOPMENT -- published Feb 2026, only 8 GitHub commits, 4 stars
- **Verdict:** Promising direction but too immature. Only ships bundled voice packs (Amy, John, Kristin, Norman, Rohan) -- unclear if custom models like lessac-medium can be loaded. Worth monitoring.

### Comparison Matrix

| Criterion | sherpa_onnx | piper_tts | piper_tts_plugin |
|-----------|------------|-----------|------------------|
| iOS support | Yes | No | No |
| Downloads/week | ~9,100 | ~0 | ~8 |
| Custom Piper model loading | Yes (any .onnx) | Requires conversion | Bundled packs only |
| Phonemization | espeak-ng (native) | DeepPhonemizer | espeak (via plugin) |
| Last updated | Weekly | Mar 2024 | Feb 2026 |
| GitHub stars | 3,800+ | Repo deleted | 4 |
| Production apps using it | Multiple | None known | None known |

**Decision: sherpa-onnx.** It is the only option with iOS support, active maintenance, and the ability to load our specific lessac-medium model directly.

## Concerns Identified During Discovery

1. **Memory:** ~500MB peak RAM is high. Must test on target devices before committing.
2. **Isolate communication:** Passing large Float32List audio buffers between isolates may have overhead. Consider `TransferableTypedData`.
3. **espeak-ng-data:** Must be filesystem files, not Flutter assets. Extraction from assets to filesystem adds first-launch latency.
4. **Build size:** sherpa-onnx native libs add ~7.2MB to APK (acceptable).

## Next Steps

After this task:
- Task 003: Download and bundle optimal Piper model (INT8 evaluation)
- Task 004: Wire into voice pipeline as fallback
