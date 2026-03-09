# Task 001: Local Piper TTS Technical Specification

**Epic:** 19 - Local Piper TTS Integration
**Status:** [x] Complete (Discovery Phase)
**Priority:** High (COGS Reduction + Reliability)
**Last Updated:** 2026-03-08

## Objective

Design and implement on-device Piper TTS in the Fletcher mobile app as a **fail-over reliability layer** that eliminates voice delivery failures and drops voice-out COGS to $0.

## Problem Statement

### Current Pain Points

1. **Silent Delivery (BUG-030, BUG-034):** When server-side TTS fails (Gemini rate limits, network timeouts), the response text arrives via the data channel but no audio is generated -- the user sees text but hears nothing.

2. **COGS Pressure:** Cloud TTS (Google/ElevenLabs) costs ~$0.135/min, making "unlimited voice" economically impossible at current pricing ($4.99/mo target).

3. **Network Dependency:** TTS requires a round-trip to the server or cloud provider, adding latency and creating a single point of failure.

### The Opportunity

**Transcripts are already arriving reliably** via the `ganglia-events` data channel topic. When server-side voice fails, we have the text -- we just need to speak it locally.

---

## Discovery Findings (2026-03-08)

### 1. sherpa-onnx Flutter Integration: FEASIBLE

**Package:** [`sherpa_onnx` v1.12.28](https://pub.dev/packages/sherpa_onnx) (published 2026-02-28)

**Maturity Assessment:**
- Actively maintained with frequent releases (~weekly)
- 92 likes, 130 pub points, ~9.1k weekly downloads on pub.dev
- Published by the official k2-fsa organization
- Apache 2.0 license
- Platform-specific sub-packages: `sherpa_onnx_android`, `sherpa_onnx_ios`, `sherpa_onnx_linux`, `sherpa_onnx_macos`, `sherpa_onnx_windows`

**Platform Support:**
- Android (arm64-v8a, armeabi-v7a) -- min SDK 23
- iOS (arm64) -- min iOS 13.0
- Desktop (Linux, macOS, Windows)
- Web (WASM) -- not relevant for our use case

**API Surface (Dart):**
```dart
import 'package:sherpa_onnx/sherpa_onnx.dart';

// Configure for Piper VITS model
final config = OfflineTtsConfig(
  model: OfflineTtsModelConfig(
    vits: OfflineTtsVitsModelConfig(
      model: '$modelDir/en_US-lessac-medium.onnx',
      tokens: '$modelDir/tokens.txt',
      dataDir: '$modelDir/espeak-ng-data',  // REQUIRED for Piper
      noiseScale: 0.667,
      noiseScaleW: 0.8,
      lengthScale: 1.0,
    ),
    numThreads: 2,    // CPU threads for inference
    provider: 'cpu',  // 'cpu' is the only reliable option for TTS
  ),
);

final tts = OfflineTts(config);

// Synchronous generation (blocks until complete)
final audio = tts.generate(
  text: 'Hello, how are you today?',
  sid: 0,      // speaker ID (0 for single-speaker models)
  speed: 1.0,  // playback speed
);

// audio.samples -> Float32List of PCM samples
// audio.sampleRate -> 22050 (for medium quality)

tts.free(); // IMPORTANT: must free native memory
```

**Key Findings:**
- The `tts.generate()` call is synchronous/blocking -- must run on an isolate or compute thread
- `espeak-ng-data` directory is REQUIRED for Piper models (handles phonemization)
- The espeak-ng-data directory is shared across all Piper languages
- Model files must be extracted from Flutter assets to the filesystem before loading (ONNX runtime needs filesystem paths, not asset streams)
- Native memory must be explicitly freed via `tts.free()`

**Verdict:** sherpa-onnx is the clear best choice. It is the most mature, most actively maintained, and most feature-complete Flutter TTS package that supports Piper models.

### 2. Piper Model Compatibility: CONFIRMED

sherpa-onnx explicitly supports all Piper models. The project converts Piper models into its `vits-piper-*` format, but can also load raw Piper ONNX models directly with the correct configuration.

**Required files for a Piper model in sherpa-onnx:**
1. `.onnx` model file (e.g., `en_US-lessac-medium.onnx`)
2. `.onnx.json` config file (contains phoneme maps, inference params)
3. `tokens.txt` (phoneme-to-ID mapping, generated from the JSON config)
4. `espeak-ng-data/` directory (phonemization data, ~3-5MB compressed)

**Existing assets in Fletcher repo:**
- `models/piper/en_US-lessac-medium.onnx` (63MB) -- already in repo
- `models/piper/en_US-lessac-medium.onnx.json` (5KB) -- already in repo
- `tokens.txt` -- NOT in repo, needs to be generated/downloaded
- `espeak-ng-data/` -- NOT in repo, must be downloaded from sherpa-onnx releases

### 3. Model Sizes and Architecture: SIGNIFICANTLY LARGER THAN ESTIMATED

**CRITICAL CORRECTION:** The original task files estimated the model at ~15-20MB. The actual sizes are:

| Model | ONNX File Size | Sample Rate | VITS Architecture | Notes |
|-------|---------------|-------------|-------------------|-------|
| `en_US-lessac-low` | **63.2 MB** | 16,000 Hz | Medium (hidden=192, inter=192, filter=768) | Same arch as medium, lower sample rate |
| `en_US-lessac-medium` | **63.2 MB** | 22,050 Hz | Medium (hidden=192, inter=192, filter=768) | **Recommended** |
| `en_US-lessac-high` | **114 MB** | 22,050 Hz | Large (same encoder, bigger decoder: resblock "1", upsample_channels=512) | ~1.8x larger |

**Why low and medium are the same size (63 MB):**

This was confirmed by the Piper developer (synesthesiam): "The low-quality models are actually of medium size (architecture), the only difference is they are trained on data preprocessed with 16kHz resolution." The Piper training CLI (`--quality` flag) defines three architecture tiers:

| Quality Flag | `hidden_channels` | `inter_channels` | `filter_channels` | Decoder | Sample Rate |
|-------------|-------------------|-------------------|--------------------|---------| ------------|
| `x-low` | 96 | 96 | 384 | resblock "2" (smaller) | 16,000 Hz |
| `medium` (default) | 192 | 192 | 768 | resblock "2" (standard) | 22,050 Hz |
| `high` | 192 | 192 | 768 | resblock "1" (larger: 3x kernel sizes, 512 upsample channels) | 22,050 Hz |

Critically, there is no `--quality low` flag in Piper training. The "low" quality models on Hugging Face use the **medium architecture** trained on **16kHz audio data** (i.e., `--quality medium` with 16kHz preprocessing). This is why `en_US-lessac-low` is 63 MB -- identical to medium.

True x-low models (96 hidden channels) would be significantly smaller (~16-20 MB), but there are no x-low lessac models available. The developer stated there "wasn't enough of a difference in performance for me to spend time training x-low quality versions of all the voices."

**Total on-device storage requirement:**
- ONNX model: ~63 MB
- espeak-ng-data: ~3-5 MB (estimated, shared across languages)
- tokens.txt: <1 KB
- onnx.json: ~5 KB
- **Total: ~66-68 MB**

**sherpa-onnx runtime library:**
- `libonnxruntime.so` (arm64-v8a): ~5.8 MB
- Other native libs: ~1.4 MB
- **Runtime total: ~7.2 MB**

**APK size impact: ~73-75 MB increase** (model + runtime)

This is significantly more than the ~20MB originally estimated. This makes **download-on-first-use (Option B) much more attractive** than APK bundling (Option A).

### 4. Performance Expectations

**Raspberry Pi 4 benchmarks (official, en_US-lessac-medium):**

| Threads | RTF (Real-Time Factor) |
|---------|----------------------|
| 1 thread | 0.774 |
| 2 threads | 0.482 |
| 3 threads | 0.390 |
| 4 threads | 0.357 |

RTF < 1.0 means faster than real-time. RTF 0.482 (2 threads) means a 3-second utterance takes ~1.45 seconds to synthesize.

**Estimated Android performance (extrapolated):**

The Raspberry Pi 4 has a Cortex-A72 @ 1.5GHz. Modern Android SoCs (Pixel 6/7 with Tensor/Tensor G2, Snapdragon 8-series) have significantly faster CPU cores (Cortex-X1/X2/X3 @ 2.8-3.0GHz). We can reasonably expect:

| Device Class | Estimated RTF (2 threads) | 3s utterance synthesis time |
|-------------|--------------------------|---------------------------|
| High-end (Pixel 7, SD 8 Gen 2) | 0.15-0.25 | 450-750ms |
| Mid-range (Pixel 6a, SD 7 Gen 1) | 0.25-0.40 | 750-1200ms |
| Low-end (SD 6-series) | 0.40-0.60 | 1200-1800ms |

**Latency breakdown for a typical 2-sentence response (~30 words, ~3s audio):**
- Model loading (cold start): 500-2000ms (one-time)
- Phonemization (espeak-ng): ~50-100ms
- ONNX inference: ~500-1200ms (device-dependent)
- **Total first-utterance latency: 550-1300ms** (after model is loaded)

This is within the <500ms target for high-end devices but may exceed it on mid-range. Sentence-level chunking can reduce perceived latency.

### 5. Memory and Battery Impact

**Memory:**
- Model loaded in RAM: ~500 MB peak (reported by users)
- This is significantly higher than the 63MB file size because ONNX runtime allocates internal buffers, computation graphs, and intermediate tensors
- After initial warmup, working memory settles to ~100-200 MB
- This is a concern for low-end devices with 3-4GB RAM

**Battery:**
- No specific Android benchmarks found
- CPU-intensive inference will consume more battery than network TTS
- Estimated: 2-4% per hour of continuous TTS (based on similar ONNX models)
- Mitigation: Only used as fallback, not primary TTS

**Risk: Memory pressure on low-end devices**
- Chrome kills Piper WASM tabs at ~80MB on Galaxy A14 (4GB RAM)
- Native Android gives more memory headroom but still a concern
- Must implement model unloading when idle (5-minute timeout as spec'd)

### 6. NNAPI / Hardware Acceleration: NOT VIABLE FOR TTS

**Critical finding:** NNAPI (Android Neural Networks API) crashes with Piper/VITS TTS models. A known sherpa-onnx issue (#958) reports dimension incompatibilities when using NNAPI with TTS models. The NNAPI executor reports GATHER operation failures.

**Status by feature:**
- NNAPI for ASR: works well
- NNAPI for TTS: crashes, not supported
- CoreML (iOS): untested for TTS, likely similar issues
- CPU: the only reliable execution provider for TTS

**Implication:** All performance optimization must focus on CPU-level improvements (thread count, quantization, model architecture) rather than hardware acceleration.

### 7. Alternative Approaches Evaluated

| Package | Version | Maturity | Verdict |
|---------|---------|----------|---------|
| [`sherpa_onnx`](https://pub.dev/packages/sherpa_onnx) | 1.12.28 | High (92 likes, 9.1k/wk downloads) | **RECOMMENDED** |
| [`piper_tts`](https://pub.dev/packages/piper_tts) | 0.0.1 | Low (66 total downloads, 3 likes) | Not production-ready (see detailed evaluation below) |
| [`piper_tts_plugin`](https://pub.dev/packages/piper_tts_plugin) | 0.0.2 | Low (123 downloads, 1 like) | Newer but still early-stage (see below) |
| [`flutter_tts`](https://pub.dev/packages/flutter_tts) | Stable | High (uses OS TTS engine) | No Piper support |
| Platform channels + raw ONNX Runtime | N/A | DIY | Too much work for MVP |

**sherpa-onnx is the recommended integration path.** The Piper-specific Flutter packages were evaluated thoroughly (see below) and none are production-ready. flutter_tts uses the OS TTS engine (Google TTS / Apple Siri) and cannot load custom ONNX models.

#### 7a. `piper_tts` (v0.0.1) -- Detailed Evaluation

**Published:** March 2024 (23 months ago, no updates since)
**Publisher:** Mobile-Artificial-Intelligence (unverified on pub.dev)
**Platforms:** Android, Linux, Windows (NO iOS support)
**License:** MIT
**Stats:** 3 likes, 150 pub points, 66 total downloads

**API Surface:**
```dart
import 'package:piper_tts/piper_tts.dart';

// Static property for model path
Piper.modelPath = '/path/to/model.onnx';

// Generate speech -- returns a File with audio
final file = await Piper.generateSpeech('Hello world');
```

The API is minimal but clean. The `Piper` class exposes:
- `Piper.modelPath` (read/write String) -- set the model file location
- `Piper.generateSpeech(String text)` -- returns `Future<File>` with audio
- `Piper.lib` (read-only) -- internal library instance

**Architecture:** Uses `ffi` bindings (Dart FFI) to call into native code. The underlying native library is [`babylon.cpp`](https://github.com/Mobile-Artificial-Intelligence/babylon.cpp), a C/C++ library that reimplements the Piper TTS pipeline using ONNX Runtime with its own DeepPhonemizer-based phonemization (rather than espeak-ng). Piper models are "compatible after a conversion script is run."

**Critical Issues:**
1. **Changelog states "Android not working yet"** -- the only platform most relevant to Fletcher
2. **GitHub repository returns 404** -- the original `Mobile-Artificial-Intelligence/piper_tts` repo appears deleted or renamed
3. **0% API documentation** on pub.dev (0 of 6 API elements documented)
4. **No iOS support** -- Fletcher needs both Android and iOS
5. **No updates in 23 months** -- appears abandoned
6. **Requires model conversion** -- Piper models need conversion to babylon.cpp format, adding friction
7. **No espeak-ng phonemization** -- uses DeepPhonemizer instead, which may produce different pronunciations

**Verdict:** Despite having a clean API design, `piper_tts` is not usable for production. The "Android not working yet" admission in its own changelog, the deleted GitHub repo, and 23 months of inactivity make it a dead end.

#### 7b. `piper_tts_plugin` (v0.0.2) -- Detailed Evaluation

**Published:** February 2026 (15 days ago as of writing)
**Publisher:** dev-6768 (unverified on pub.dev)
**Platforms:** Android, Windows (iOS planned)
**License:** MIT
**Stats:** 1 like, 150 pub points, 123 total downloads
**GitHub:** [dev-6768/piper_tts_plugin](https://github.com/dev-6768/piper_tts_plugin) (4 stars, 8 commits)

**API Surface:**
```dart
// Load a voice pack
await _tts.loadViaVoicePack(PiperVoicePack.norman);

// Synthesize to file
await _tts.synthesizeToFile(text, outputPath);
```

**Key differences from piper_tts:**
- Uses `onnxruntime` package directly (not babylon.cpp)
- Ships with built-in voice packs (Amy, John, Kristin, Norman, Rohan)
- Depends on `piper_phonemizer_plugin` for phonemization
- More actively maintained (last commit Feb 2026)

**Critical Issues:**
1. **Only 8 commits total** -- extremely early development
2. **No iOS support** (planned but not implemented)
3. **4 stars on GitHub** -- minimal community validation
4. **Bundled voice packs only** -- not clear if custom models (like lessac-medium) can be loaded
5. **Depends on `onnxruntime` Flutter package** -- adds another dependency layer vs sherpa-onnx's integrated approach

**Verdict:** More promising than `piper_tts` and actively developing, but too early for production use. Worth monitoring for future evaluation. The bundled-voice-pack approach is limiting compared to sherpa-onnx's flexibility with any Piper model.

#### 7c. Why sherpa-onnx Remains the Right Choice

| Criterion | sherpa_onnx | piper_tts | piper_tts_plugin |
|-----------|------------|-----------|------------------|
| Platform coverage | Android, iOS, desktop | Android (broken), Linux, Windows | Android, Windows |
| Downloads/week | ~9,100 | ~0 | ~8 |
| Last updated | Feb 2026 (weekly releases) | Mar 2024 (23mo ago) | Feb 2026 |
| iOS support | Yes (arm64, min iOS 13) | No | No (planned) |
| Custom model support | Any Piper ONNX model | Requires conversion | Bundled packs only |
| espeak-ng phonemization | Yes (native integration) | No (DeepPhonemizer) | Yes (via plugin) |
| API documentation | Comprehensive | 0% | Minimal |
| GitHub stars | 3.8k+ (sherpa-onnx) | Repo deleted | 4 |
| Community/maintainer | k2-fsa (academic org, 15+ contributors) | Solo dev, inactive | Solo dev, new |

### 8. INT8 Quantization Opportunity

**Pre-quantized models: NOT available for Piper lessac.** The official Piper voices on Hugging Face (`rhasspy/piper-voices`) are distributed in FP32 ONNX format only. No INT8 or FP16 variants are provided. The sherpa-onnx project provides pre-quantized INT8 models for *some* voices (e.g., `vits-vctk.int8.onnx` at 37 MB vs 116 MB FP32), but NOT for the Piper lessac models specifically. Manual quantization is required.

The medium model can be quantized from FP32 to INT8:
- Original size: 63 MB
- Expected quantized size: ~22 MB (3x reduction, based on vits-vctk ratios)
- Expected inference speedup: ~2-4x
- Quality: slight degradation, usually imperceptible

This could bring the model download to ~22MB + 5MB espeak-ng-data = ~27MB, much more reasonable for download-on-first-use.

**Quantization command (ONNX Runtime dynamic quantization):**
```bash
python -m onnxruntime.quantization.quantize_dynamic \
  --model_input en_US-lessac-medium.onnx \
  --model_output en_US-lessac-medium-int8.onnx \
  --op_types_to_quantize MatMul
```

**Note:** The Piper export process already runs `onnx-simplifier` on the model, so the FP32 ONNX file is already graph-optimized. The quantization step only affects weight precision, not graph structure.

This should be evaluated during prototyping (Task 002). Quality validation is essential -- VITS TTS models can be sensitive to quantization artifacts in the decoder (vocoder) layers.

---

## Revised Architecture

### Bundling Strategy: REVISED

Given the 63MB model size (not 18MB as originally estimated), the recommended approach is now:

**Option B: Download-on-First-Use (Recommended)**
- APK ships without model (~7MB sherpa-onnx runtime only)
- On first TTS fallback trigger, download model (~63MB or ~22MB quantized)
- Store in app's internal storage
- Show download progress to user
- Cache indefinitely, check for model updates on app startup

**Rationale:**
- 63-75MB APK size increase is unacceptable for a conversational app
- Google Play Store recommends apps under 150MB
- Most users will never trigger local TTS fallback (cloud TTS works >95% of the time)
- First-time download only; subsequent launches use cached model

**Fallback for offline-first users:**
- Consider a "Download Voice Pack" button in settings
- Users who want offline TTS can pre-download the model

### Required Model Files (Download Package)

```
piper-voice-pack-v1.tar.gz (~25MB quantized, ~65MB FP32)
  ├── en_US-lessac-medium.onnx          (63 MB or 22 MB quantized)
  ├── en_US-lessac-medium.onnx.json     (5 KB)
  ├── tokens.txt                         (<1 KB)
  └── espeak-ng-data/                    (~3-5 MB)
      ├── phontab
      ├── phonindex
      ├── phondata
      ├── intonations
      └── ... (language data files)
```

---

## Proposed Architecture: Fail-Over Local Synthesis

### Tier 1: Cloud TTS (Primary)
- Current default: Google Cloud TTS / ElevenLabs via voice agent
- High quality, low latency when network is solid
- Cost: ~$0.135/min

### Tier 2: Server Piper (Fallback)
- Current fallback: Piper Docker sidecar (already implemented in `apps/voice-agent/src/piper-tts.ts`)
- Good quality, no cloud API dependency
- Cost: ~$0.02/min (compute only)
- TTS fallback monitor already publishes "Voice Degraded" / "Voice Restored" artifacts (`apps/voice-agent/src/tts-fallback-monitor.ts`)

### Tier 3: **Local Piper (NEW - Ultimate Fallback)**
- On-device ONNX inference via sherpa-onnx
- Triggers when Tier 1 & 2 fail OR user is offline
- Cost: **$0** (zero COGS)

### Existing Infrastructure to Leverage

The server-side already has the building blocks:
1. **TTS Fallback Monitor** (`tts-fallback-monitor.ts`) -- publishes "Voice Degraded" / "Voice Unavailable" artifacts via ganglia-events data channel
2. **Piper TTS sidecar** (`piper-tts.ts`) -- HTTP-based Piper synthesis at 22050 Hz, WAV output, PCM extraction
3. **Model config** (`models/piper/en_US-lessac-medium.onnx.json`) -- inference params (noise_scale: 0.667, length_scale: 1, noise_w: 0.8)
4. **Connectivity service** (`apps/mobile/lib/services/connectivity_service.dart`) -- already tracks online/offline state
5. **TTS toggle** (`apps/mobile/lib/widgets/tts_toggle.dart`) -- UI already supports toggling TTS on/off

---

## Fail-Over Flow

### Normal Operation (Cloud TTS Available)

```
1. User speaks -> VAD triggers
2. STT transcribes -> text sent to OpenClaw
3. OpenClaw responds -> transcript deltas arrive via data channel
4. Voice agent synthesizes -> LiveKit audio track plays
5. App displays transcript + plays audio
```

### Fail-Over Mode (Cloud TTS Unavailable)

```
1. User speaks -> VAD triggers
2. STT transcribes -> text sent to OpenClaw
3. OpenClaw responds -> transcript deltas arrive via data channel
4. Voice agent detects TTS failure -> sends "Voice Unavailable" artifact
   (already partially implemented in tts-fallback-monitor.ts)
5. App receives artifact -> switches to LOCAL PIPER MODE
6. App pipes transcript deltas -> local Piper engine -> audio output
7. App displays transcript + plays LOCAL audio
```

---

## Risks and Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| **63MB model size** (not 18MB) | High | Use download-on-first-use; evaluate INT8 quantization (~22MB) |
| **~500MB RAM during inference** | High | Unload model after 5min idle; gate feature on device capability |
| **NNAPI crashes with TTS** | Medium | Use CPU-only inference; accept lower perf on low-end devices |
| **Blocking `generate()` call** | Medium | Run synthesis on a Dart isolate to avoid UI jank |
| **espeak-ng-data dependency** | Low | Bundle with model download; shared across all Piper voices |
| **Model cold-start latency** | Medium | Pre-load model on session start; keep in memory during active conversation |
| **Quality mismatch between cloud and local** | Low | Use same voice (`lessac-medium`) as server Piper sidecar |

## Recommended Approach

1. **Integration path:** sherpa-onnx Flutter package (v1.12.28+)
2. **Model:** `en_US-lessac-medium` (matches server-side Piper voice)
3. **Bundling:** Download-on-first-use with INT8 quantization evaluation
4. **Execution:** CPU-only (2 threads), synthesis on Dart isolate
5. **Trigger:** Explicit "Voice Unavailable" artifact + audio timeout watchdog
6. **Memory management:** Load on session start, unload after 5min idle

## Open Questions

1. **INT8 quality:** Is the quality loss from INT8 quantization acceptable? No pre-quantized Piper lessac models exist -- we must quantize ourselves and do A/B listening test. VITS decoder layers may be sensitive to quantization.
2. **Model hosting:** Where do we host the model download? CDN vs Hugging Face vs GitHub releases?
3. **iOS CoreML:** Does CoreML acceleration work for TTS on iOS? (NNAPI does not on Android)
4. **Sentence chunking:** Can sherpa-onnx generate audio incrementally per-sentence, or must it process the full text?
5. **Audio playback:** How do we play raw PCM samples in Flutter while LiveKit audio track is active? Need AudioOutputService.
6. **piper_tts_plugin trajectory:** The `piper_tts_plugin` package (v0.0.2, Feb 2026) is actively developing. Worth re-evaluating in 3-6 months if it adds iOS support and matures, but sherpa-onnx remains the clear choice for now.

## References

### Flutter Integration Packages
- [sherpa_onnx Flutter Package (pub.dev)](https://pub.dev/packages/sherpa_onnx) -- **Recommended**
- [sherpa_onnx Dart API docs](https://pub.dev/documentation/sherpa_onnx/latest/)
- [sherpa-onnx Flutter TTS Example](https://github.com/k2-fsa/sherpa-onnx/tree/master/flutter-examples/tts)
- [piper_tts Flutter Package (pub.dev)](https://pub.dev/packages/piper_tts) -- v0.0.1, evaluated and not recommended
- [piper_tts_plugin Flutter Package (pub.dev)](https://pub.dev/packages/piper_tts_plugin) -- v0.0.2, evaluated and not recommended
- [babylon.cpp (native TTS library behind piper_tts)](https://github.com/Mobile-Artificial-Intelligence/babylon.cpp)

### Piper TTS Project
- [Piper TTS Voices (Hugging Face)](https://huggingface.co/rhasspy/piper-voices)
- [Piper lessac model directory](https://huggingface.co/rhasspy/piper-voices/tree/main/en/en_US/lessac)
- [Piper Voice Quality Levels](https://github.com/rhasspy/piper/blob/master/VOICES.md)
- [Piper VITS Config (quality-level architecture)](https://github.com/rhasspy/piper/blob/master/src/python/piper_train/vits/config.py)
- [Piper Training Script (quality flag handling)](https://github.com/rhasspy/piper/blob/master/src/python/piper_train/__main__.py)
- [Piper developer on low vs medium quality](https://huggingface.co/datasets/rhasspy/piper-checkpoints/discussions/8)

### sherpa-onnx Documentation
- [sherpa-onnx Piper Integration Docs](https://k2-fsa.github.io/sherpa/onnx/tts/piper.html)
- [sherpa-onnx VITS Pretrained Models (benchmarks)](https://k2-fsa.github.io/sherpa/onnx/tts/pretrained_models/vits.html)
- [sherpa-onnx TTS Model Downloads](https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models)
- [sherpa-onnx NNAPI TTS crash (Issue #958)](https://github.com/k2-fsa/sherpa-onnx/issues/958)
- [Piper Memory Usage (Issue #484)](https://github.com/rhasspy/piper/issues/484)
- [ONNX Runtime Mobile](https://onnxruntime.ai/docs/tutorials/mobile/)

### Fletcher Project
- [Fletcher Server-Side Piper TTS](../../apps/voice-agent/src/piper-tts.ts)
- [Fletcher TTS Fallback Monitor](../../apps/voice-agent/src/tts-fallback-monitor.ts)
- [Fletcher TTS Provider Factory](../../apps/voice-agent/src/tts-provider.ts)
- [Fletcher Piper Model Config](../../models/piper/en_US-lessac-medium.onnx.json)

## Next Steps

1. **Task 002 (Prototype):** Build minimal spike with sherpa-onnx, verify Piper synthesis works on Android
2. **Task 003 (Model Selection):** Evaluate INT8 quantized model; benchmark low vs medium quality
3. **Task 004 (Pipeline):** Design VoiceFallbackController integration with existing ganglia-events
4. **Task 005 (Performance):** Benchmark on Pixel 6/7, measure memory and battery
5. **Task 006 (Offline):** Coordinate with ConnectivityService for offline mode
