# Task 003: Piper Model Selection & Bundling Strategy

**Epic:** 19 - Local Piper TTS Integration
**Status:** [~] Partially Complete (Research done, benchmarking pending)
**Depends on:** 001 (Technical Spec) -- COMPLETE, 002 (Sherpa-ONNX Integration) -- Backlog

## Objective

Select the optimal Piper voice model for on-device synthesis and implement the bundling/delivery strategy.

## Discovery Findings (from Task 001, updated 2026-03-08)

### Model Size Reality Check

**CRITICAL:** The original estimates in this task were wrong. Updated with actual data from Hugging Face:

| Model | ONNX Size | Sample Rate | VITS Architecture | Decoder |
|-------|-----------|-------------|-------------------|---------|
| `en_US-lessac-low` | **63.2 MB** | 16,000 Hz | Medium (hidden=192, inter=192, filter=768) | resblock "2" (standard) |
| `en_US-lessac-medium` | **63.2 MB** | 22,050 Hz | Medium (hidden=192, inter=192, filter=768) | resblock "2" (standard) |
| `en_US-lessac-high` | **114 MB** | 22,050 Hz | Medium encoder + Large decoder (resblock "1", upsample_channels=512) | resblock "1" (larger) |

### Why low and medium are the same size

Confirmed by the Piper developer (synesthesiam): "The low-quality models are actually of medium size (architecture), the only difference is they are trained on data preprocessed with 16kHz resolution."

The Piper training CLI (`--quality` flag) defines three architecture tiers -- `x-low`, `medium` (default), and `high`. There is **no `--quality low`** flag. "Low" quality models use the medium architecture trained on 16kHz audio. This is why they are 63 MB, identical to medium.

True x-low models (hidden_channels=96, inter=96, filter=384) would be significantly smaller (~16-20 MB estimated), but no x-low lessac models are available on Hugging Face.

**Bottom line:** There is zero size benefit to using "low" quality. Medium is strictly superior (same size, higher fidelity output at 22.05kHz).

### Piper Model File Format

Each Piper voice is distributed as exactly two files on Hugging Face (`rhasspy/piper-voices`):
1. **`.onnx`** -- the VITS neural network (FP32, already graph-optimized via onnx-simplifier during export)
2. **`.onnx.json`** -- configuration file (sample rate, phoneme ID map, inference params, speaker info)

Additional files needed for sherpa-onnx integration:
3. **`tokens.txt`** -- phoneme-to-ID mapping (generated from the `.onnx.json` phoneme_id_map)
4. **`espeak-ng-data/`** -- phonemization data directory (~3-5 MB, downloaded from sherpa-onnx releases)

**All models are FP32 only.** No INT8 or FP16 variants are distributed by Piper.

### INT8 Quantization (Size Reduction Path)

**Pre-quantized Piper models do NOT exist.** The official `rhasspy/piper-voices` repository on Hugging Face distributes FP32 ONNX models only. The sherpa-onnx project provides pre-quantized INT8 models for *some* voices (e.g., `vits-vctk.int8.onnx` at 37 MB vs 116 MB FP32, a 3.1x reduction), but NOT for Piper lessac models specifically.

Manual quantization is required. Expected results (based on vits-vctk ratios):
- FP32: 63 MB --> INT8: ~20-22 MB (3x reduction)
- Expected inference speedup: ~2-4x
- Quality: slight degradation, but VITS decoder layers may be sensitive -- requires listening test

**Important caveat:** VITS models use a neural vocoder (HiFi-GAN-derived decoder) that converts mel spectrograms to audio waveforms. Quantization artifacts in the decoder can produce audible buzzing or metallic sounds. The encoder and flow layers typically quantize well, but the decoder requires careful validation.

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
- Same file size as medium (63 MB) -- uses identical VITS medium architecture (hidden=192)
- Lower audio quality (16 kHz vs 22.05 kHz output)
- "Low" is just medium architecture trained on 16 kHz audio data -- no size or speed benefit
- Strictly dominated by medium in every dimension

### NOT Recommended: `en_US-lessac-high`

**Why not:**
- 114 MB file size (~1.8x medium)
- Same encoder architecture as medium (hidden=192), but much larger decoder (resblock "1" with 3x kernel sizes, 512 upsample channels)
- Quality difference barely perceptible on phone speakers
- Significantly slower inference due to larger decoder
- Not used server-side, so no voice consistency benefit

### Not Available: `en_US-lessac-x_low`

**Note:** No x-low quality lessac model exists on Hugging Face. True x-low models use a smaller architecture (hidden=96, inter=96, filter=384) and would be significantly smaller (~16-20 MB), but the Piper developer did not train x-low versions for most voices.

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
  en_US-lessac-medium.onnx       (63 MB, Git LFS) -- FP32 ONNX, graph-optimized
  en_US-lessac-medium.onnx.json  (4.89 KB)        -- config with phoneme_id_map, inference params
```

These are the exact same FP32 files distributed on Hugging Face (`rhasspy/piper-voices`). No quantized variants exist upstream -- they must be created manually.

**Config file key fields (from `en_US-lessac-medium.onnx.json`):**
- `audio.sample_rate`: 22050
- `audio.quality`: "medium"
- `inference.noise_scale`: 0.667
- `inference.length_scale`: 1
- `inference.noise_w`: 0.8
- `phoneme_type`: "espeak"
- `num_speakers`: 1
- `num_symbols`: 256
- `piper_version`: "1.0.0"

**Missing files for sherpa-onnx integration:**
- `tokens.txt` -- needs to be generated from the `phoneme_id_map` in the JSON config (or downloaded from sherpa-onnx)
- `espeak-ng-data/` -- needs to be downloaded from sherpa-onnx releases (~3-5 MB compressed)

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

## Piper Model Format Details

### Distribution Format

All Piper voices on Hugging Face are distributed as:
- **FP32 ONNX** models (no quantized variants available upstream)
- Each voice = 2 files: `.onnx` (model) + `.onnx.json` (config)
- Models are exported via `piper_train/export_onnx.py` and post-processed with `onnx-simplifier`

### VITS Architecture Per Quality Level (from Piper source code)

| Quality | Training Flag | hidden_channels | inter_channels | filter_channels | Decoder (resblock) | Sample Rate |
|---------|--------------|-----------------|----------------|-----------------|-------------------|-------------|
| x-low | `--quality x-low` | 96 | 96 | 384 | "2" (smaller) | 16,000 Hz |
| low | `--quality medium` + 16kHz data | 192 | 192 | 768 | "2" (standard) | 16,000 Hz |
| medium | `--quality medium` (default) | 192 | 192 | 768 | "2" (standard) | 22,050 Hz |
| high | `--quality high` | 192 | 192 | 768 | "1" (larger: 3 kernel sizes, 512 upsample channels) | 22,050 Hz |

Source: [piper/src/python/piper_train/vits/config.py](https://github.com/rhasspy/piper/blob/master/src/python/piper_train/vits/config.py) and [piper/src/python/piper_train/__main__.py](https://github.com/rhasspy/piper/blob/master/src/python/piper_train/__main__.py)

### Quantization Options (All Manual)

| Method | Tool | Target | Expected Size Reduction | Notes |
|--------|------|--------|------------------------|-------|
| Dynamic INT8 | `onnxruntime.quantization` | MatMul ops | ~3x (63 MB -> ~22 MB) | Best for CPU inference |
| Static INT8 | `onnxruntime.quantization` | All ops | ~3-4x | Requires calibration dataset |
| FP16 | ONNX model converter | All weights | ~2x (63 MB -> ~32 MB) | Minimal quality loss but limited speedup on CPU |

**Recommendation:** Start with dynamic INT8 quantization targeting MatMul operations. This matches what sherpa-onnx uses for its pre-quantized models (e.g., vits-vctk.int8.onnx). Validate quality before deploying.

### Reference: sherpa-onnx Pre-Quantized Models (Not Piper Lessac)

For reference, the sherpa-onnx project provides INT8 models for some voices:
- `vits-vctk.onnx`: 116 MB (FP32) -> `vits-vctk.int8.onnx`: 37 MB (INT8) -- 3.1x reduction
- `kitten-mini-en-v0_1-fp16`: FP16 quantized model (separate project)

These demonstrate that VITS models can be quantized successfully, but the quality impact must be verified per-model.

## Next Steps

After this task:
- Task 004: Wire local TTS into voice pipeline as fallback
- Task 005: Optimize performance and battery impact
