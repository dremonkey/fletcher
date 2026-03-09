# Task 003: Piper Model Selection & Bundling Strategy

**Epic:** 19 - Local Piper TTS Integration
**Status:** [~] Partially Complete (Research done, benchmarking pending)
**Depends on:** 001 (Technical Spec) -- COMPLETE, 002 (Sherpa-ONNX Integration) -- Backlog

## Objective

Select the optimal Piper voice model for on-device synthesis and implement the bundling/delivery strategy.

## Discovery Findings (from Task 001)

### Model Size Reality Check

**CRITICAL:** The original estimates in this task were wrong. Updated with actual data:

| Model | ONNX Size | Sample Rate | Quality | Parameters |
|-------|-----------|-------------|---------|------------|
| `en_US-lessac-low` | **63.2 MB** | 16,000 Hz | Acceptable | 15-20M |
| `en_US-lessac-medium` | **63.2 MB** | 22,050 Hz | Good | 15-20M |
| `en_US-lessac-high` | **114 MB** | 22,050 Hz | Excellent | 28-32M |

Key insight: low and medium models are the SAME architecture (same parameter count, same file size). The only difference is the training data preprocessing:
- **Low:** trained on 16kHz audio (lower fidelity output)
- **Medium:** trained on 22.05kHz audio (higher fidelity output)

There is effectively no size benefit to using the "low" model. The quality difference is audible, so **medium is strictly better than low**.

### INT8 Quantization (Size Reduction Path)

Quantizing the FP32 model to INT8 can reduce the file from ~63MB to ~22MB:
- 3x size reduction
- 2-4x inference speedup
- Slight quality degradation (usually imperceptible)

This is the primary lever for reducing download size.

## Model Selection: RECOMMENDATION

### Primary: `en_US-lessac-medium` (FP32)

**Why:**
- Matches the server-side Piper voice exactly (voice consistency)
- Server config: `models/piper/en_US-lessac-medium.onnx.json` (noise_scale: 0.667, length_scale: 1, noise_w: 0.8, sample_rate: 22050)
- Medium quality is perceptually very close to high quality (most users cannot distinguish on phone speakers)
- Single speaker (speaker_id: 0), English US

### Alternative: `en_US-lessac-medium` (INT8 quantized)

**When to use:**
- If FP32 is too slow on mid-range devices
- If 63MB download is too large for user acceptance
- Trade slight quality for 3x smaller size and 2-4x faster inference

### NOT Recommended: `en_US-lessac-low`

**Why not:**
- Same file size as medium (63MB)
- Lower audio quality (16kHz vs 22.05kHz)
- No benefit over medium

### NOT Recommended: `en_US-lessac-high`

**Why not:**
- 114 MB file size (almost 2x medium)
- Quality difference barely perceptible on phone speakers
- Significantly slower inference (28-32M params vs 15-20M)
- Not used server-side, so no voice consistency benefit

## Bundling Strategy: REVISED

### Original vs Revised Recommendation

| | Original Plan | Revised Plan |
|--|---|---|
| **Strategy** | APK Bundle (Option A) | Download-on-First-Use (Option B) |
| **Estimated Model Size** | ~18 MB | **63 MB** (or ~22 MB quantized) |
| **APK Impact** | +20 MB | **+70-75 MB** (unacceptable) |
| **Rationale** | Small enough to bundle | Too large; most users never need local TTS |

### Recommended: Download-on-First-Use

**Implementation:**

```dart
class PiperModelManager {
  static const _modelVersion = '1.0.0';
  static const _modelUrl = 'https://cdn.fletcher.app/models/piper/v1/';

  /// Check if model is downloaded and ready
  Future<bool> isModelReady() async {
    final modelDir = await _getModelDir();
    final modelFile = File('${modelDir.path}/en_US-lessac-medium.onnx');
    return modelFile.existsSync();
  }

  /// Download model files with progress callback
  Future<void> downloadModel({
    required void Function(double progress) onProgress,
  }) async {
    final modelDir = await _getModelDir();
    await modelDir.create(recursive: true);

    final files = [
      ('en_US-lessac-medium.onnx', 63 * 1024 * 1024),    // 63 MB
      ('en_US-lessac-medium.onnx.json', 5 * 1024),        // 5 KB
      ('tokens.txt', 1024),                                 // ~1 KB
      ('espeak-ng-data.tar.gz', 5 * 1024 * 1024),         // ~5 MB
    ];

    var totalDownloaded = 0;
    final totalSize = files.fold(0, (sum, f) => sum + f.$2);

    for (final (filename, expectedSize) in files) {
      await _downloadFile(
        '$_modelUrl$filename',
        '${modelDir.path}/$filename',
        onProgress: (bytes) {
          totalDownloaded += bytes;
          onProgress(totalDownloaded / totalSize);
        },
      );
    }

    // Extract espeak-ng-data
    await _extractTarGz(
      '${modelDir.path}/espeak-ng-data.tar.gz',
      modelDir.path,
    );
  }

  Future<Directory> _getModelDir() async {
    final appDir = await getApplicationDocumentsDirectory();
    return Directory('${appDir.path}/models/piper/$_modelVersion');
  }
}
```

### User-Triggered Download

Two trigger paths:

1. **Automatic:** When fallback TTS is needed but model isn't downloaded
   - Show toast: "Downloading local voice pack..."
   - Non-blocking, continue showing text transcript
   - Next fallback event will use local TTS

2. **Manual:** Settings screen "Download Offline Voice"
   - Shows download progress
   - Allows users to proactively prepare for offline use

### Model Hosting Options

| Option | Pros | Cons |
|--------|------|------|
| **CDN (e.g., CloudFront/R2)** | Fast, global, reliable | Cost (~$0.085/GB) |
| **GitHub Releases** | Free, reliable | Rate limits, no CDN |
| **Hugging Face** | Free, models already there | Slow in some regions |
| **Bundle in APK expansion** (OBB/PAD) | Google-managed delivery | Complex setup |

**Recommendation:** Start with GitHub Releases for MVP, migrate to CDN if download speed becomes an issue.

## Existing Model Files in Repo

Fletcher already has the Piper model files for the server-side sidecar:

```
models/piper/
  en_US-lessac-medium.onnx       (63 MB, Git LFS)
  en_US-lessac-medium.onnx.json  (5 KB)
```

These are the exact same files needed for local TTS. Missing:
- `tokens.txt` -- needs to be generated or downloaded from sherpa-onnx
- `espeak-ng-data/` -- needs to be downloaded from sherpa-onnx releases

## Benchmarking Plan (Pending)

### Test Matrix

| Model Variant | Device | Metrics |
|--------------|--------|---------|
| medium (FP32, 63MB) | Pixel 7 | RTF, latency, RAM |
| medium (FP32, 63MB) | Pixel 6a | RTF, latency, RAM |
| medium (INT8, ~22MB) | Pixel 7 | RTF, latency, RAM |
| medium (INT8, ~22MB) | Pixel 6a | RTF, latency, RAM |

### Test Utterances

```dart
final testCases = [
  // Short (1 sentence, ~10 words)
  'Hello, how can I help you today?',
  // Medium (2-3 sentences, ~30 words)
  'The weather is sunny with a high of 72 degrees. It should be a great day for a walk.',
  // Long (paragraph, ~60 words)
  'Here is a longer response that spans multiple sentences. It tests synthesis performance on complex input. The model should handle punctuation, pauses, and natural pacing without stuttering or excessive latency. This is the kind of response length we see from OpenClaw during typical conversations.',
];
```

### Quality Assessment

- A/B comparison: server-side Piper vs local Piper (should be identical if same model)
- A/B comparison: FP32 vs INT8 quantized (quality difference?)
- Subjective rating on phone speaker vs headphones

## Success Criteria

- [x] ~~Model variants researched and documented~~ (Task 001 discovery)
- [x] ~~Model sizes validated against actual files~~ (63 MB confirmed)
- [x] ~~Bundling strategy selected~~ (Download-on-first-use)
- [ ] INT8 quantized model generated and quality-tested
- [ ] Benchmark results on target devices
- [ ] espeak-ng-data downloaded and validated
- [ ] tokens.txt generated/downloaded and validated
- [ ] Model download pipeline implemented
- [ ] APK size impact measured (runtime only, no model)

## Next Steps

After this task:
- Task 004: Wire local TTS into voice pipeline as fallback
- Task 005: Optimize performance and battery impact
