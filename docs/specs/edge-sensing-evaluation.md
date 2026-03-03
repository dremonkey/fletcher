# Technical Spec: Edge Sensing Evaluation

**Status:** Draft
**Date:** 2026-03-02
**Supersedes:** `edge-sensing-pivot.md` (initial sketch)
**Question:** Is running VAD/STT/TTS on the edge device while keeping only the LLM brain remote viable and beneficial?

---

## Current State (Fletcher, field-tested)

```
Mobile (thin client) ──WebRTC──> LiveKit SFU ──> Voice Agent (hub)
                                                       │
                                                 Silero VAD (server)
                                                 Deepgram STT (cloud)
                                                 ElevenLabs TTS (cloud)
                                                 OpenClaw LLM (local/cloud)
```

- Mobile sends raw Opus audio, receives Opus playback
- All sensing runs server-side or via cloud APIs from the hub
- Edge does: audio capture, AEC/NS/AGC, BT route recovery, reconnection

---

## Proposed State

```
Edge Device (vessel/mobile)              Hub (remote brain)
┌──────────────────────────┐             ┌─────────────────────┐
│  Mic → Silero VAD        │             │                     │
│  VAD → Whisper STT       │──text──────>│  LLM (OpenClaw)     │
│  Text → Piper/ONNX TTS  │<──text──────│                     │
│  TTS → Speaker           │             └─────────────────────┘
└──────────────────────────┘
```

- Edge sends **text** (transcripts) to hub, receives **text** (LLM responses)
- LiveKit still used for signaling/data channels, but no longer for audio SFU
- Audio never leaves the device

---

## Evaluation Matrix

### 1. Latency — Killing "Nose Hole" Gaps

**STRONG PRO**

| Stage | Current (hub) | Proposed (edge) | Delta |
|-------|--------------|-----------------|-------|
| VAD/EOU detection | +50-100ms (network RTT) | ~50ms (local Silero) | **-50-100ms** |
| STT (speech→text) | 200-400ms (Deepgram cloud) | 300-800ms (Whisper Tiny, local) | **+100-400ms** |
| Text→Hub RTT | 0ms (already at hub) | 50-100ms (new hop) | **+50-100ms** |
| TTS (text→audio) | 193-257ms (ElevenLabs cloud) + 50ms WebRTC return | 50-200ms (Piper local) | **-50-100ms** |
| **Net change** | | | **~0 to +300ms** |

**Key insight:** Raw latency is roughly a wash. The real win is elsewhere:

- **Immediate EOU feedback** — device knows user stopped speaking in ~50ms, can show UI/play chime instantly without waiting for hub RTT
- **TTS starts locally** — no WebRTC decode hop on playback path
- **But:** Local Whisper is slower than Deepgram streaming. Whisper Tiny on ARM ≈ 300-800ms; Deepgram Nova-3 streaming ≈ 200-400ms
- **Net:** Modest latency win for VAD/EOU responsiveness. STT speed is a tradeoff unless NPU-accelerated

### 2. Connectivity Resilience — 5G/WiFi Handoffs

**STRONG PRO**

Current pain (field-tested, BUG-015):
- WiFi→5G "break before make" = 40-80s blackout
- Tailscale tunnel renegotiation adds latency
- Required `departure_timeout: 120` as a band-aid
- BT route changes kill WebRTC peer connections (BUG-004/017)

Edge sensing fixes:
- **VAD/STT work offline** — device captures and transcribes regardless of network state
- **Buffered resumption** — transcript queued locally, sent when connection restores
- **No WebRTC audio dependency** — BT route changes don't kill the sensing pipeline, only the text data channel (much easier to reconnect)
- **Graceful degradation** — user can speak, see their transcript, and get "waiting for connection" instead of dead silence
- **Eliminates `isExpectedToResume` fragility** — no ICE renegotiation for audio streams

Risk:
- Still need network for LLM responses — offline means no agent replies
- Data channel reconnection still needed (but lighter than full WebRTC media)

### 3. Interaction Naturalness — VAD/EOU Speed

**MODERATE PRO**

Current issues (BUG-014, BUG-009):
- Premature EOU: server VAD has 50-100ms network jitter on top of detection latency
- False interruptions: STT fragments natural pauses into separate turns
- Required tuning: `minEndpointingDelay: 0.8`, `activationThreshold: 0.6`

Edge sensing improvements:
- **Zero-jitter VAD** — Silero runs on local audio frames, no network variance
- **Tighter EOU loop** — can correlate VAD + local STT interim results for smarter turn detection
- **Local barge-in** — device can instantly stop TTS playback on VAD trigger (no hub RTT)
- **Acoustic context** — edge has direct access to ambient noise level, can adapt thresholds dynamically

Risk:
- Loses server-side `EnglishModel` turn detector (language-aware EOU) unless replicated locally
- Local Whisper interim results may be less accurate than Deepgram streaming

### 4. Hardware Requirements

**SIGNIFICANT CON**

| Component | Model | ARM CPU (no NPU) | With NPU (RK3588) | Mobile (Pixel 9) |
|-----------|-------|-------------------|-------------------|-------------------|
| Silero VAD | silero_vad.onnx (~2MB) | ~5ms/frame | ~2ms/frame | ~3ms/frame |
| Whisper STT | Whisper Tiny (39M params) | 300-800ms/utterance | 100-300ms | 200-500ms |
| Whisper STT | Whisper Small (244M params) | 2-5s/utterance | 500ms-1s | 1-2s |
| Piper TTS | Medium voice (~60MB) | 100-300ms TTFB | 50-150ms | 80-200ms |
| Sherpa-ONNX TTS | Various | 150-400ms TTFB | 80-200ms | 100-250ms |
| **Total RAM** | | ~200-400MB | ~200-400MB | ~200-400MB |

Feasibility by target:

- **Dedicated Hub (RK3588 w/ NPU)** — Viable. 6 TOPS NPU handles Whisper Tiny + VAD comfortably. Piper TTS is lightweight. This is the natural home for edge sensing.
- **Dedicated Hub (RK3562)** — Marginal. Weaker NPU (1 TOP), Whisper Tiny feasible but tight. May need Whisper ONNX quantized (int8).
- **Mobile (Pixel 9, Snapdragon 8 Gen 3)** — Viable but battery-intensive. Hexagon NPU can run Whisper Tiny. Expect 10-15% additional battery drain during active conversation.
- **Mobile (mid-range Android)** — Risky. No NPU, ARM CPU only. Whisper Tiny at 500-800ms may be acceptable; Whisper Small is too slow.
- **Raspberry Pi 4** — Marginal. No NPU. Whisper Tiny works but at upper latency bound (~800ms). Fine for prototyping.

Battery impact (mobile):
- Continuous VAD monitoring: ~2-3% additional drain/hour
- Active STT (Whisper Tiny): ~8-12% drain/hour during conversation
- Local TTS: ~3-5% drain/hour during playback
- **Total active conversation overhead: ~13-20%/hour**

### 5. Data Sovereignty & Privacy

**STRONG PRO**

Current state:
- Raw audio streams to hub via WebRTC (LAN/Tailscale — private, but leaves device)
- Hub forwards to Deepgram (cloud STT) and ElevenLabs (cloud TTS) — audio leaves the network
- Only LLM receives text (transcripts), not audio

Edge sensing:
- **Raw audio never leaves the device** — only text transcripts sent to hub
- **Hub never touches audio** — can't leak, can't be subpoenaed, can't be breached
- **Cloud APIs eliminated for sensing** — no Deepgram, no ElevenLabs dependency
- **Aligns with local-first philosophy** — audio processing within user's physical control
- **GDPR/privacy story simplified** — no third-party audio processors

Risk:
- Local models less accurate than cloud APIs (Whisper Tiny vs Deepgram Nova-3)
- Voice cloning/fingerprinting features may still need high-quality audio sent to hub
- TTS quality tradeoff: Piper/Sherpa-ONNX vs ElevenLabs quality gap is significant

---

## Architecture Implications

### What Changes

| Concern | Current | Proposed |
|---------|---------|----------|
| LiveKit role | Audio SFU (WebRTC media) | Data channel relay (text/events only) |
| Hub voice-agent | Full pipeline (VAD+STT+LLM+TTS) | LLM-only orchestrator |
| Edge complexity | Thin client (capture + playback) | Thick client (full sensing stack) |
| Network payload | Opus audio (~32kbps) | Text (~1-5 KB/turn) |
| Cloud API dependency | Deepgram + ElevenLabs (per-turn cost) | None for sensing (cost savings) |
| Maintenance surface | 1 voice-agent (hub) | N edge platforms (Android/iOS/ARM) |

### What Stays the Same

- LiveKit for signaling, data channels, room management, agent dispatch
- Tailscale/WireGuard mesh for private networking
- OpenClaw/Nanoclaw as LLM backend (still remote)
- Acknowledgment chime pattern (now local, even simpler)
- Ganglia data channel protocol (`ganglia-events` — transcripts, status, artifacts)

### New Complexity

- **Model distribution** — shipping/updating Whisper + Piper models to edge devices
- **Platform fragmentation** — Rust (dedicated hub) vs Dart/native (Flutter mobile) vs potential Swift (iOS)
- **Quality parity** — ensuring local STT accuracy matches Deepgram for the use case
- **Hybrid fallback** — option to fall back to cloud STT/TTS when local quality is insufficient or device is low-power

---

## Verdict

| Dimension | Weight | Score (edge) | Notes |
|-----------|--------|-------------|-------|
| Latency (nose hole) | 25% | **+1** (modest win) | Real win is EOU responsiveness, not raw pipeline speed |
| Connectivity resilience | 25% | **+3** (strong win) | Eliminates the #1 field-tested pain point |
| Interaction naturalness | 20% | **+2** (good win) | Zero-jitter VAD, instant barge-in |
| Hardware requirements | 15% | **-2** (significant cost) | NPU needed for good STT perf; battery hit on mobile |
| Data sovereignty | 15% | **+3** (strong win) | Audio never leaves device; cloud APIs eliminated |

**Weighted score: +1.4 (net positive)**

### Recommendation

**Yes, viable and beneficial — with a phased approach:**

1. **Phase 1 (now):** Prototype local VAD + Whisper Tiny on Pixel 9 (Flutter). Benchmark battery, STT accuracy vs Deepgram, and EOU responsiveness. This validates the mobile path and informs dedicated hub hardware spec.

2. **Phase 2 (dedicated hub):** Implement full edge sensing in the Rust audio service (already spec'd in `awakening-edge.md`). RK3588 NPU makes this the natural first-class target. VAD + Whisper + Piper, text-only to hub.

3. **Phase 3 (hybrid mode):** Support both paths — edge sensing for capable devices, hub sensing as fallback for thin clients. LiveKit data channels already support this (just change what's in the payload).

**The connectivity resilience win alone justifies the pivot.** Field testing proved that WebRTC audio over mobile networks is fragile (BUG-004, BUG-015, BUG-017). Reducing the network dependency to text-only data channels eliminates the entire class of "audio transport death" bugs.

**The quality tradeoff is the main risk.** Whisper Tiny vs Deepgram Nova-3 and Piper vs ElevenLabs are meaningful downgrades. Phase 1 prototyping must validate that the accuracy and voice quality are acceptable for the use case.

---

*Generated by Glitch (Static) — Claude Code, 2026-03-02*
