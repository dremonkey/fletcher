# Task 002: Sherpa-ONNX Flutter Integration

**Epic:** 19 - Local Piper TTS Integration  
**Status:** 📋 Backlog  
**Depends on:** 001 (Technical Spec & Discovery)

## Objective

Integrate the `sherpa-onnx` Flutter package into the Fletcher mobile app to enable on-device Piper TTS inference.

## Requirements

- Add `sherpa-onnx` package dependency to Flutter project
- Implement platform-specific setup (Android/iOS)
- Create `LocalPiperTTS` service wrapper
- Verify model loading and basic synthesis

## Implementation

### 1. Add Dependencies

**pubspec.yaml:**
```yaml
dependencies:
  sherpa_onnx: ^1.10.0  # Latest stable version
  path_provider: ^2.1.0 # For model file paths
```

### 2. Platform Setup

**Android (android/app/build.gradle):**
```gradle
android {
    defaultConfig {
        minSdkVersion 24  // sherpa-onnx requirement
        ndk {
            abiFilters 'armeabi-v7a', 'arm64-v8a'
        }
    }
}
```

**iOS (ios/Podfile):**
```ruby
platform :ios, '13.0'  # sherpa-onnx requirement
```

### 3. Create LocalPiperTTS Service

**lib/services/local_piper_tts.dart:**
```dart
import 'package:sherpa_onnx/sherpa_onnx.dart';
import 'package:flutter/services.dart';
import 'package:path_provider/path_provider.dart';
import 'dart:io';

class LocalPiperTTS {
  OfflineTts? _tts;
  bool _initialized = false;
  
  /// Initialize the Piper TTS engine with bundled model
  Future<void> initialize() async {
    if (_initialized) return;
    
    try {
      // Extract model files from assets to app directory
      final modelDir = await _extractModelFromAssets();
      
      // Create TTS engine
      _tts = await OfflineTts.create(
        model: OfflineTtsModelConfig(
          vits: OfflineTtsVitsModelConfig(
            model: '$modelDir/en_US-lessac-medium.onnx',
            tokens: '$modelDir/tokens.txt',
            dataDir: modelDir,
            lengthScale: 1.0,
            noiseScale: 0.667,
            noiseScaleW: 0.8,
          ),
        ),
      );
      
      _initialized = true;
      print('LocalPiperTTS initialized successfully');
    } catch (e) {
      print('Failed to initialize LocalPiperTTS: $e');
      rethrow;
    }
  }
  
  /// Extract Piper model files from assets to app directory
  Future<String> _extractModelFromAssets() async {
    final appDir = await getApplicationDocumentsDirectory();
    final modelDir = Directory('${appDir.path}/models/piper');
    
    if (!await modelDir.exists()) {
      await modelDir.create(recursive: true);
      
      // Extract model files
      final files = [
        'en_US-lessac-medium.onnx',
        'en_US-lessac-medium.onnx.json',
        'tokens.txt',
      ];
      
      for (final file in files) {
        final data = await rootBundle.load('assets/models/piper/$file');
        final outFile = File('${modelDir.path}/$file');
        await outFile.writeAsBytes(
          data.buffer.asUint8List(data.offsetInBytes, data.lengthInBytes),
        );
      }
    }
    
    return modelDir.path;
  }
  
  /// Synthesize text to audio samples (Int16 PCM, 22050 Hz)
  Future<GeneratedAudio> synthesize(String text) async {
    if (!_initialized || _tts == null) {
      throw StateError('LocalPiperTTS not initialized');
    }
    
    final audio = _tts!.generate(
      text: text,
      speed: 1.0,
      speakerId: 0,
    );
    
    return audio;
  }
  
  /// Generate audio and return as stream of PCM samples
  Stream<Float32List> synthesizeStream(String text) async* {
    final audio = await synthesize(text);
    
    // Convert Int16 samples to Float32 for audio playback
    final samples = Float32List(audio.samples.length);
    for (int i = 0; i < audio.samples.length; i++) {
      samples[i] = audio.samples[i] / 32768.0; // Normalize to [-1, 1]
    }
    
    yield samples;
  }
  
  /// Dispose of resources
  void dispose() {
    _tts?.free();
    _tts = null;
    _initialized = false;
  }
}
```

### 4. Register Service (Dependency Injection)

**lib/main.dart:**
```dart
void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  
  // Initialize local TTS
  final localTts = LocalPiperTTS();
  await localTts.initialize();
  
  runApp(
    MultiProvider(
      providers: [
        Provider.value(value: localTts),
        // ... other providers
      ],
      child: FletcherApp(),
    ),
  );
}
```

## Testing

### Unit Test

**test/services/local_piper_tts_test.dart:**
```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:fletcher/services/local_piper_tts.dart';

void main() {
  late LocalPiperTTS tts;
  
  setUp(() {
    tts = LocalPiperTTS();
  });
  
  tearDown(() {
    tts.dispose();
  });
  
  test('should initialize successfully', () async {
    await tts.initialize();
    expect(tts._initialized, true);
  });
  
  test('should synthesize simple text', () async {
    await tts.initialize();
    
    final audio = await tts.synthesize('Hello world');
    
    expect(audio.samples.isNotEmpty, true);
    expect(audio.sampleRate, 22050);
  });
  
  test('should throw if synthesize called before init', () async {
    expect(
      () => tts.synthesize('test'),
      throwsStateError,
    );
  });
}
```

### Integration Test

**integration_test/local_tts_test.dart:**
```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:fletcher/main.dart' as app;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  
  testWidgets('local TTS should generate audio', (tester) async {
    app.main();
    await tester.pumpAndSettle();
    
    // TODO: Trigger local TTS synthesis and verify audio output
  });
}
```

## Asset Bundling

Add model files to `pubspec.yaml`:

```yaml
flutter:
  assets:
    - assets/models/piper/en_US-lessac-medium.onnx
    - assets/models/piper/en_US-lessac-medium.onnx.json
    - assets/models/piper/tokens.txt
```

**Note:** Model files must be downloaded separately from the Piper repository and placed in `assets/models/piper/`. See Task 003 for model selection.

## Success Criteria

- [ ] `sherpa-onnx` package integrated and building on Android/iOS
- [ ] `LocalPiperTTS` service loads Piper model successfully
- [ ] `synthesize()` method generates valid PCM audio samples
- [ ] Unit tests passing
- [ ] Integration test verifies end-to-end synthesis

## Files Modified

- `pubspec.yaml` (add dependencies)
- `android/app/build.gradle` (min SDK version)
- `ios/Podfile` (platform version)
- `lib/services/local_piper_tts.dart` (new file)
- `lib/main.dart` (register service)
- `test/services/local_piper_tts_test.dart` (new file)

## Next Steps

After this task:
- Task 003: Download and bundle optimal Piper model
- Task 004: Wire into voice pipeline as fallback
