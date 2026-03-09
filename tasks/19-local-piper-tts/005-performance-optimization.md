# Task 005: Performance Optimization & Battery Impact

**Epic:** 19 - Local Piper TTS Integration
**Status:** 📋 Backlog
**Depends on:** 004 (Fail-Over Pipeline Integration)

## Discovery Notes (from Task 001 research, 2026-03-08)

**Critical findings that affect this task:**

1. **NNAPI does NOT work for TTS.** The spec below suggests enabling NNAPI delegate. This will crash the app. sherpa-onnx Issue #958 confirms NNAPI produces dimension errors with VITS TTS models. CPU-only is the only viable provider. Remove all NNAPI optimization plans from scope.

2. **Memory is the biggest risk, not latency.** Piper models consume ~500MB peak RAM during inference (vs the ~100MB target in this spec). This is a show-stopper for low-end devices with 3-4GB RAM. Priority should be: (a) measure actual RAM usage on target devices, (b) evaluate if INT8 quantization reduces memory proportionally, (c) implement aggressive model unloading.

3. **RTF benchmarks are encouraging.** Raspberry Pi 4 (Cortex-A72 @ 1.5GHz) achieves RTF 0.482 with 2 threads. Modern Android SoCs are 2-3x faster, suggesting RTF 0.15-0.25 on Pixel 7. The <500ms latency target for 1-2 sentence utterances appears achievable on high-end devices.

4. **Thread count tradeoff.** More threads = faster synthesis but higher battery drain. Recommend starting with numThreads=2 and benchmarking. 1 thread is too slow; 4 threads provides diminishing returns and excessive power draw.

5. **CoreML (iOS) is untested.** No data on whether CoreML acceleration works for Piper TTS on iOS. This is an open question.

## Objective

Optimize on-device Piper TTS inference for production use, ensuring acceptable latency, memory usage, and battery impact.

## Target Metrics

### Performance Targets

| Metric | Target | Acceptable | Unacceptable |
|--------|--------|------------|--------------|
| **Synthesis Latency** | <300ms | <500ms | >1000ms |
| **Real-Time Ratio** | <0.3x | <0.5x | >1.0x |
| **Memory Usage** | <75MB | <100MB | >150MB |
| **Battery Drain** | <3% per 30min | <5% per 30min | >10% per 30min |
| **App Launch Impact** | <100ms | <200ms | >500ms |

### Test Devices

- **High-end:** Pixel 7 Pro, iPhone 14 Pro (baseline)
- **Mid-range:** Pixel 6a, iPhone 12 (optimization target)
- **Low-end:** Budget Android (Snapdragon 6-series) (acceptable degradation)

## Optimization Strategies

### 1. ONNX Runtime Acceleration

Enable hardware acceleration via NNAPI (Android) and CoreML (iOS):

**lib/services/local_piper_tts.dart:**
```dart
class LocalPiperTTS {
  Future<void> initialize() async {
    final modelDir = await _extractModelFromAssets();
    
    _tts = await OfflineTts.create(
      model: OfflineTtsModelConfig(
        vits: OfflineTtsVitsModelConfig(
          model: '$modelDir/en_US-lessac-medium.onnx',
          tokens: '$modelDir/tokens.txt',
          dataDir: modelDir,
          // Performance tuning
          numThreads: 2,  // Use 2 CPU threads (balance speed vs. battery)
          provider: 'cpu', // Start with CPU, test NNAPI later
        ),
      ),
    );
    
    debugPrint('LocalPiperTTS initialized with ${_tts.sampleRate} Hz sample rate');
  }
}
```

**NNAPI Experimentation (Android):**
```dart
// Try enabling NNAPI acceleration
final config = OfflineTtsVitsModelConfig(
  model: modelPath,
  provider: 'nnapi',  // Hardware acceleration
);

// Fallback to CPU if NNAPI fails
try {
  _tts = await OfflineTts.create(model: config);
} catch (e) {
  debugPrint('NNAPI not available, falling back to CPU: $e');
  config.provider = 'cpu';
  _tts = await OfflineTts.create(model: config);
}
```

### 2. Model Quantization

If `medium` quality is too slow, try quantized variants:

**INT8 Quantization:**
- Reduces model size by ~4x
- Speeds up inference by ~2-4x
- Slight quality degradation (usually acceptable)

**How to generate INT8 model:**
```bash
# Using ONNX Runtime quantization tools
python -m onnxruntime.quantization.quantize_dynamic \
  --model_input en_US-lessac-medium.onnx \
  --model_output en_US-lessac-medium-int8.onnx \
  --op_types_to_quantize MatMul
```

**Test and compare:**
- Original FP32 model: ~18MB, slower
- Quantized INT8 model: ~5MB, faster
- Evaluate quality difference via blind listening tests

### 3. Streaming Synthesis (Reduce Perceived Latency)

Instead of waiting for full text synthesis, stream audio in chunks:

```dart
Stream<Float32List> synthesizeStream(String text) async* {
  // Split text into sentences
  final sentences = _splitIntoSentences(text);
  
  for (final sentence in sentences) {
    // Synthesize each sentence independently
    final audio = await _tts.generate(text: sentence, speed: 1.0);
    
    // Convert and yield immediately
    final samples = _convertToFloat32(audio.samples);
    yield samples;
  }
}

List<String> _splitIntoSentences(String text) {
  // Simple sentence splitting (improve with better NLP)
  return text
      .split(RegExp(r'[.!?]+'))
      .map((s) => s.trim())
      .where((s) => s.isNotEmpty)
      .toList();
}
```

**Benefit:** User hears first sentence while subsequent sentences are still being synthesized.

### 4. Model Caching & Preloading

Keep the model loaded in memory during active sessions:

```dart
class LocalPiperTTS {
  bool _modelLoaded = false;
  Timer? _unloadTimer;
  
  Future<void> _ensureModelLoaded() async {
    if (_modelLoaded) {
      _resetUnloadTimer();
      return;
    }
    
    // Load model
    await initialize();
    _modelLoaded = true;
    _resetUnloadTimer();
  }
  
  void _resetUnloadTimer() {
    _unloadTimer?.cancel();
    
    // Unload model after 5 minutes of idle
    _unloadTimer = Timer(Duration(minutes: 5), () {
      _unloadModel();
    });
  }
  
  void _unloadModel() {
    _tts?.free();
    _tts = null;
    _modelLoaded = false;
    debugPrint('LocalPiperTTS model unloaded to free memory');
  }
}
```

### 5. Preload on App Launch (Background)

Load the model in the background during app startup:

```dart
// lib/main.dart
void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  
  // Start local TTS initialization in background
  final localTts = LocalPiperTTS();
  unawaited(localTts.initialize()); // Don't block UI
  
  runApp(MyApp());
}
```

**Tradeoff:** Slightly higher memory usage at launch, but zero latency on first fallback.

## Battery Impact Analysis

### Measurement Methodology

Use Flutter DevTools battery profiler:

```dart
class BatteryBenchmark {
  Future<void> runBenchmark() async {
    final batteryStart = await Battery().batteryLevel;
    final timeStart = DateTime.now();
    
    // Run continuous TTS for 30 minutes
    for (int i = 0; i < 30; i++) {
      await _synthesizeTestUtterance();
      await Future.delayed(Duration(minutes: 1));
    }
    
    final batteryEnd = await Battery().batteryLevel;
    final timeEnd = DateTime.now();
    
    final batteryDrain = batteryStart - batteryEnd;
    final duration = timeEnd.difference(timeStart);
    
    print('Battery drain: $batteryDrain% over ${duration.inMinutes} minutes');
  }
}
```

### Optimization Levers

1. **Reduce Thread Count:** Use 1 thread instead of 2 (slower but less battery)
2. **Lower Sample Rate:** Use 16kHz instead of 22kHz (smaller audio, less CPU)
3. **Quantized Model:** INT8 uses less power than FP32

## Profiling Tools

### Android

```bash
# Profile CPU usage during synthesis
adb shell top -m 10

# Profile memory usage
adb shell dumpsys meminfo com.example.fletcher

# Profile battery usage
adb shell dumpsys batterystats --charged com.example.fletcher
```

### iOS

Use Xcode Instruments:
- **Time Profiler:** Identify CPU-intensive functions
- **Allocations:** Track memory usage
- **Energy Log:** Measure battery impact

## Benchmark Script

**tools/benchmark_local_tts.dart:**
```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:fletcher/services/local_piper_tts.dart';

void main() {
  test('Benchmark local TTS performance', () async {
    final tts = LocalPiperTTS();
    await tts.initialize();
    
    final testCases = [
      'Hello, how are you today?',
      'The weather in San Francisco is sunny with a high of 72 degrees.',
      'This is a longer sentence that contains multiple words and should test the synthesis performance more thoroughly.',
    ];
    
    for (final text in testCases) {
      final start = DateTime.now();
      final audio = await tts.synthesize(text);
      final duration = DateTime.now().difference(start);
      
      final audioLengthSec = audio.samples.length / audio.sampleRate;
      final realTimeRatio = duration.inMilliseconds / (audioLengthSec * 1000);
      
      print('Text: "$text"');
      print('  Length: ${text.length} chars');
      print('  Synthesis time: ${duration.inMilliseconds}ms');
      print('  Audio length: ${audioLengthSec.toStringAsFixed(2)}s');
      print('  Real-time ratio: ${realTimeRatio.toStringAsFixed(2)}x');
      print('');
      
      // Assert performance targets
      expect(duration.inMilliseconds, lessThan(500), 
        reason: 'Synthesis should be <500ms');
      expect(realTimeRatio, lessThan(0.5),
        reason: 'Should be faster than real-time');
    }
  });
}
```

Run with:
```bash
flutter test tools/benchmark_local_tts.dart
```

## Regression Testing

Add performance tests to CI:

**.github/workflows/performance-tests.yml:**
```yaml
name: Performance Tests

on: [pull_request]

jobs:
  benchmark:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v3
      - uses: subosito/flutter-action@v2
      
      - name: Run TTS benchmarks
        run: flutter test tools/benchmark_local_tts.dart
      
      - name: Check performance regression
        run: |
          # Compare against baseline metrics
          if [ $SYNTHESIS_TIME_MS -gt 500 ]; then
            echo "Performance regression: synthesis time exceeded 500ms"
            exit 1
          fi
```

## Success Criteria

- [ ] Synthesis latency <500ms on Pixel 6a
- [ ] Real-time ratio <0.5x on mid-range devices
- [ ] Memory usage <100MB peak
- [ ] Battery drain <5% per 30min continuous use
- [ ] Model loads in <200ms on app launch
- [ ] NNAPI acceleration tested (if available)
- [ ] Quantized model evaluated (if needed)
- [ ] Benchmark results documented

## Files Modified

- `lib/services/local_piper_tts.dart` (optimization flags, caching)
- `tools/benchmark_local_tts.dart` (new file)
- `test/performance/tts_performance_test.dart` (new file)
- `.github/workflows/performance-tests.yml` (new file)

## Next Steps

After this task:
- Task 006: Coordinate with offline mode and edge intelligence
- Document performance benchmarks in CHANGELOG.md
