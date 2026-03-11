# Epic 22: Dual-Mode Architecture (Voice / Chat Split)

**Goal:** Split the single voice-agent pipeline into two distinct operating modes — **Voice Mode** (LiveKit agent, server-side STT/TTS) and **Chat Mode** (direct OpenClaw API, client-side STT/TTS) — so that text conversations don't depend on the voice agent process or WebRTC connection.

**Problem:** The current architecture routes all communication — voice and text — through the LiveKit voice agent via a data channel. This means:

1. **Text mode keeps the voice pipeline alive.** WebRTC holds the Android mic in `MODE_IN_COMMUNICATION` even when muted, blocking native keyboard STT. The ICE connection stays up, triggering audio track refreshes on network handoffs — all for a text conversation.
2. **Sleep/wake is overloaded.** It handles both "user stopped talking" (voice concern) and "no recent activity" (session concern). Wake-up requires re-syncing TTS state, segment IDs, and audio tracks because the agent doesn't know if it's waking into voice or text.
3. **Every fix adds coupling.** The settle window, mute guards, segment ID resets, thinking-state timer resets — each patches the assumption that one pipeline serves both modes.

Evidence: 10 of 14 bugs from the March 9–10 field testing sessions trace directly to sleep/wake state management or the voice pipeline being active during text input (see `docs/field-tests/20260309-buglog.md` and `docs/field-tests/20260310-buglog.md`).

**Solution:** Two clean pipelines that share a conversation session but nothing else:

```
VOICE MODE                                    CHAT MODE
──────────                                    ─────────
LiveKit Room (active)                         LiveKit Room (none / dormant)
Server STT (Deepgram)                         Client STT (native speech_to_text)
Agent → Ganglia → OpenClaw                    Flutter → OpenClaw API (direct HTTP/SSE)
Server TTS (Piper/Google)                     Client TTS (pluggable: native / Cartesia / Gemini)
Mic: WebRTC (MODE_IN_COMMUNICATION)           Mic: OS-native (MODE_NORMAL)
Agent sleep/wake: YES                         Agent sleep/wake: N/A
```

Both modes share the same **OpenClaw Gateway session** (via session key) so conversation context, memory, and artifacts are continuous across mode switches.

## What This Eliminates

| Bug cluster | Why it goes away |
|---|---|
| Mic release hacks (BUG-001/003 Mar 9, BUG-009 Mar 10) | No WebRTC in chat mode → OS mic is free |
| TTS re-sync races (BUG-001 Mar 10, BUG-002 Mar 9) | Chat mode doesn't wake an agent |
| Artifact clumping (BUG-004 Mar 10) | Chat mode associates artifacts with HTTP responses |
| ICE cycling after idle (BUG-010 Mar 10) | No LiveKit room connection to degrade |
| Timer complexity (BUG-002/006/007 Mar 10) | Idle timer only runs in voice mode |
| Degraded status confusion (BUG-003 Mar 10) | Chat mode has its own health concept |

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Flutter App                        │
│                                                      │
│  ┌──────────┐         ┌──────────┐                   │
│  │ Voice    │         │ Chat     │                   │
│  │ Mode     │         │ Mode     │                   │
│  │          │         │          │                   │
│  │ LiveKit  │         │ OpenClaw │                   │
│  │ Service  │         │ Client   │                   │
│  │ (exists) │         │ (new)    │                   │
│  └────┬─────┘         └────┬─────┘                   │
│       │                    │                         │
│  ┌────┴─────┐         ┌───┴──────┐                   │
│  │ Server   │         │ Client   │                   │
│  │ STT/TTS  │         │ STT/TTS  │                   │
│  └────┬─────┘         └────┬─────┘                   │
│       │                    │                         │
│  ┌────┴────────────────────┴─────┐                   │
│  │      Unified Transcript       │                   │
│  │      (ChatTranscript)         │                   │
│  └───────────────────────────────┘                   │
│                                                      │
│  ┌───────────────────────────────┐                   │
│  │      Mode Switch Controller   │                   │
│  │   voice ←→ chat transitions   │                   │
│  └───────────────────────────────┘                   │
└──────────────────────┬──────────────────────────────┘
                       │
            ┌──────────┴──────────┐
            │  OpenClaw Gateway   │
            │  (shared session)   │
            └─────────────────────┘
```

## Status

**Epic Status:** 📋 BACKLOG

## Tasks

### 042: OpenClaw Direct Client (Flutter)
Build a Dart HTTP client that talks directly to the OpenClaw Gateway's OpenAI-compatible completions API (`/v1/chat/completions` or `/v1/responses`). Supports SSE streaming for token-by-token delivery. Uses the same session key as the voice agent (via `resolveSessionKey()` logic) so both modes share conversation context.

This is the core of chat mode — replaces the LiveKit data channel → agent → Ganglia → OpenClaw path with Flutter → OpenClaw directly.

**Status:** [ ]

---

### 043: Pluggable TTS Engine Abstraction
Define a `TtsEngine` interface in Dart with implementations:
- **NativeTtsEngine** — wraps `flutter_tts` (free, offline, platform voices)
- **CartesiaTtsEngine** — REST/WebSocket API → audio bytes → `just_audio` playback (40ms TTFA)
- **GeminiTtsEngine** — Google GenAI SDK with audio response modality

The interface: `speak(String text)`, `stop()`, `state` stream. Sentence-level streaming: as OpenClaw SSE chunks arrive, buffer into sentences, feed each to the active engine.

Engine selection via user setting (persisted in SharedPreferences).

**Status:** [ ]

---

### 044: Client-Side STT Integration
Add `speech_to_text` package for native on-device speech recognition in chat mode. STT output fills the text input field (user can review/edit before sending). This replaces the server-side Deepgram STT that runs through LiveKit.

Key: native STT uses `MODE_NORMAL` on Android — no mic conflict with WebRTC.

**Status:** [ ]

---

### 045: Chat Mode Streaming Pipeline
Wire the full chat mode pipeline: text input (typed or native STT) → OpenClaw Direct Client (042) → SSE stream → sentence buffer → TtsEngine (043) → audio out. Simultaneously render streamed text in ChatTranscript as it arrives.

Handle: interruption (user starts typing while TTS is speaking), error recovery (Gateway timeout → retry or surface error), empty responses.

**Status:** [ ]

---

### 046: Mode Switch Controller
State machine managing transitions between voice mode and chat mode:
- **Voice → Chat:** tear down LiveKit audio tracks, release WebRTC audio session, stop agent idle timer. If agent is connected, let it sleep naturally (don't force-disconnect). Switch transcript source to direct client.
- **Chat → Voice:** dispatch agent (reuse Epic 20 dispatch flow), wait for agent connect, hand off to LiveKit pipeline. Stop client-side TTS.
- **Persist mode across app restarts** (SharedPreferences).
- **Handle in-flight responses** during switch: let current response finish in its original mode before switching.

**Status:** [ ]

---

### 047: Chat Mode Artifact Delivery
Artifacts in voice mode arrive via the `ganglia-events` data channel. In chat mode, artifacts need to come from the OpenClaw SSE stream (tool call results, code blocks, etc.) and be rendered in the same ChatTranscript. Ensure `_groupArtifactsByMessage` works with both artifact sources.

**Status:** [ ]

---

### 048: Unified Transcript Across Modes
Ensure ChatTranscript seamlessly merges messages from both modes. A user might start in voice mode, switch to chat, then switch back — the transcript should be one continuous thread. Messages need a `source` tag (voice/chat) for debugging but should render identically.

Session key continuity: both modes must use the same OpenClaw session so the LLM sees the full conversation history regardless of which mode produced each message.

**Status:** [ ]

---

### 049: Voice Pipeline Clean Teardown
When switching from voice to chat mode, perform a clean shutdown of the voice pipeline:
- Unpublish audio track (not just mute — full `removePublishedTrack`)
- Release Android `AudioManager` to `MODE_NORMAL`
- Optionally disconnect from LiveKit room entirely (or keep connection dormant for fast re-entry)
- Clear stale state: `_lastAgentSegmentId`, reconnection flags, idle timer

This directly addresses the root cause of BUG-001/003 (Mar 9) and BUG-009 (Mar 10).

**Status:** [ ]

---

### 050: Migrate Text Input from Data Channel to Chat Mode
The current text input (Epic 17) routes typed messages through the LiveKit data channel to the voice agent. Migrate this to use the OpenClaw Direct Client (042) instead, so text input works without an active agent process. The data channel path remains as a fallback when in voice mode and the agent is connected.

**Status:** [ ]

---

### 051: Chat Mode Health & Error Handling
Define health semantics for chat mode: network reachability to OpenClaw Gateway, SSE stream health, TTS engine status. Update HealthService to show appropriate status (no more "Degraded" when there's simply no agent — chat mode doesn't need one).

Addresses BUG-003 (Mar 10) — system status during agent sleep.

**Status:** [ ]

## Mode Comparison

| Concern | Voice Mode | Chat Mode |
|---|---|---|
| Input | Server STT (Deepgram via LiveKit) | Native STT (`speech_to_text`) or keyboard |
| LLM routing | Agent → Ganglia → OpenClaw | Flutter → OpenClaw API (direct) |
| Output | Server TTS (Piper/Google via agent) | Client TTS (pluggable engine) |
| LiveKit room | Active, agent connected | None or dormant |
| Agent process | Running, sleep/wake managed | Not needed |
| Mic ownership | WebRTC (`MODE_IN_COMMUNICATION`) | OS-native (`MODE_NORMAL`) |
| Idle management | Agent sleep timer (Epic 20) | None (no server resources) |
| Cost when idle | $0.0005/min (room connection only) | $0 (no room) |
| Artifacts | Data channel (`ganglia-events`) | SSE stream from OpenClaw |
| Latency (first response) | STT + LLM + TTS (~1.5-3s) | LLM TTFT + client TTS (~0.5-1.5s) |

## Key Decisions

- **Session continuity via session key.** Both modes use the same `SessionKey` (Epic 4, spec 08) so OpenClaw maintains one conversation thread.
- **Client-side TTS is pluggable.** Start with `flutter_tts` (free/offline). Add cloud engines (Cartesia, Gemini) as separate implementations behind the same interface.
- **Text input defaults to chat mode.** When user taps the mic to switch to text, they're in chat mode — no agent needed.
- **Voice mode is opt-in.** User explicitly activates voice (unmute / tap mic). This dispatches the agent.
- **LiveKit room lifecycle TBD.** Open question: keep room dormant in chat mode for fast voice re-entry, or disconnect entirely for zero cost? Needs benchmarking of dispatch latency.

## Dependencies

- **Epic 4 (Ganglia)** — session key routing for shared context
- **Epic 17 (Text Input)** — existing text input UI to migrate
- **Epic 20 (Cost Optimization)** — agent dispatch/sleep mechanics
- **Epic 3 (Flutter App)** — mobile client foundation

## Anti-Goals

- **No hybrid pipeline.** A message is either routed through the agent (voice mode) or directly to OpenClaw (chat mode). Never both simultaneously.
- **No server-side TTS in chat mode.** The whole point is to eliminate the agent dependency for text conversations.
- **No breaking voice mode.** Voice mode continues to work exactly as today. This epic adds chat mode alongside it.

## References

- [Bug log: March 9 field test](../../docs/field-tests/20260309-buglog.md)
- [Bug log: March 10 field test](../../docs/field-tests/20260310-buglog.md)
- [flutter_tts](https://pub.dev/packages/flutter_tts) — platform-native TTS
- [speech_to_text](https://pub.dev/packages/speech_to_text) — platform-native STT
- [Cartesia TTS API](https://cartesia.ai/product/python-text-to-speech-api-tts) — 40ms TTFA cloud TTS
- [Gemini TTS](https://fallendeity.github.io/gemini-ts-cookbook/quickstarts/Get_started_TTS.html) — Google cloud TTS
- [just_audio](https://pub.dev/packages/just_audio) — audio playback for cloud TTS engines
