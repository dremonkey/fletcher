# Fletcher Bug Log — Field Testing Session

**Date:** 2026-03-01
**Tester:** ahanyu (mobile, outdoors — park session with Pixel 9, Android 16, Flutter SDK 2.5.4)
**Monitor:** Claude (watching logs, investigating issues)

---

## Session Summary

| Time (UTC) | Severity | Description | Status |
|------------|----------|-------------|--------|
| 18:12:20 | **CRITICAL** | Cartesia TTS: "Voice not found" — stale Docker image had hardcoded deleted voice ID | **FIXED** @ 18:19 |
| 18:04:17 | WARN | DTLS timeout on data channels when user disconnected (mobile connectivity) | Expected/benign |
| 18:05:11 | ERROR | "could not restart participant" — LiveKit failed to reconnect user after disconnect | Needs investigation |
| 18:04:37 | INFO | Room closed with job status JS_FAILED ("agent worker left the room") | Side-effect of disconnect |
| 18:08:24 | INFO | User disconnected again (PEER_CONNECTION_DISCONNECTED), room closed after departure timeout | Mobile connectivity |
| 18:12:07 | INFO | User reconnected successfully, new room RM_h2qgYERoCQLT created, job assigned | OK |
| 18:12:15 | INFO | STT working — transcript: "I don't think the open call connection is working." | OK |
| 18:12:15 | INFO | OpenClaw POST to localhost:18789 returned 200 OK, LLM streaming works (11 chunks) | OK |

---

## Detailed Entries

### BUG-001: Cartesia TTS "Voice not found" (CRITICAL)

**First seen:** 18:12:20 UTC
**Frequency:** Every TTS chunk — at least 10 consecutive errors
**Impact:** User gets NO audio response. LLM generates text but TTS can't synthesize it.

**Log excerpt:**
```
[18:12:20.953] ERROR (477): Cartesia returned error
    error: "Voice not found: The requested voice was not found."
```

**Analysis:** The voice agent is configured with a Cartesia voice ID that doesn't exist (or has been deleted/renamed in Cartesia's API). The OpenClaw LLM pipeline is working fine — the issue is exclusively in the TTS layer.

**Root cause:** The Docker image was stale. The container's `agent.ts` had:
```typescript
voice: process.env.CARTESIA_VOICE_ID || '597926e8-3233-4f9a-9e1d-91b53e89c62a'
```
Both the env var AND the hardcoded fallback ("The Alchemist") pointed to a deleted Cartesia voice.
The local source had already been fixed (no voice override), but Docker layer caching kept the old code.

**Fix applied:**
1. Removed `CARTESIA_VOICE_ID` from `.env`
2. Force-rebuilt Docker image with `--no-cache`
3. Restarted voice-agent container
4. Now using SDK default voice `794f9389-aac1-45b6-b726-9d9369183238` ("Sarah - Curious Mindful Woman"), confirmed valid via Cartesia API

---

### BUG-002: Participant restart failure

**First seen:** 18:05:11 UTC
**Impact:** User had to fully reconnect instead of resuming session.

**Log excerpt:**
```
ERROR livekit service/signal.go:186 could not handle new participant
    error: "could not restart participant"
```

**Analysis:** After a mobile disconnect (DTLS timeout), the user tried to reconnect but LiveKit couldn't restart the participant in the existing room. The room had already started closing. A new room was created instead. This is likely a race condition between the departure timeout and the reconnect attempt. Not uncommon for mobile clients with spotty connectivity.

---

### BUG-003: Repeated DTLS timeouts on disconnect

**First seen:** 18:04:17 UTC (multiple occurrences)
**Severity:** WARN (expected for mobile)

**Analysis:** When the mobile client loses connectivity, all four data channels (publisher reliable/lossy, subscriber reliable/lossy) hit DTLS read/write timeouts. This is normal behavior — LiveKit detects the peer connection is dead and cleans up. Not a bug, but documenting for completeness.

---

### Working correctly:
- **STT pipeline:** Deepgram (or configured STT) is transcribing speech correctly
- **OpenClaw integration:** POST to localhost:18789/v1/chat/completions returns 200, streaming works
- **Ganglia LLM bridge:** Converting 3 ChatMessage items, routing with guest session key
- **LiveKit room management:** Rooms created/destroyed properly, agent jobs dispatched
- **Mobile connectivity:** Pixel 9 connecting over wifi via Tailscale, ~409ms connect time

---

### BUG-004: Audio input dies on Bluetooth/speaker transitions (HIGH)

**First seen:** ~19:18–19:32 UTC (multiple occurrences)
**Severity:** HIGH — breaks the voice pipeline silently
**Impact:** STT stops receiving audio, no responses generated. User must exit app and reopen.

**Reproduction steps:**
1. Start voice session on phone speaker
2. Switch to Bluetooth (car BT, phone BT, etc.)
3. Diagnostics remain green (WebRTC connection alive)
4. STT and responses stop — audio track is silently dead
5. Exit app, wait, reopen → usually recovers

**Observed transitions that broke:**
- Phone Speaker → Car Bluetooth
- Car Bluetooth → Phone Bluetooth
- Phone Speaker → Phone Bluetooth

**Log correlation:**
- 19:18:19 — AbortError burst, session closed (first BT transition?)
- 19:27:51 — New session, "Hey there, Fletcher." works briefly
- 19:28:08 — AbortError burst, session closed again
- 19:32:27 — New session, "There?" / "Hello?" — testing if mic works
- 19:32:54 — Session closed again

**Root cause hypothesis:**
Android changes the audio input device when BT connects/disconnects, but the Flutter app doesn't detect the audio route change. The existing LiveKit audio track becomes stale (capturing from a now-inactive device). The WebRTC peer connection stays alive (ICE OK, diagnostics green), so LiveKit doesn't know the track is dead.

**Fix direction:**
- Flutter client needs to listen for audio route changes (`AudioManager` / `audio_session` plugin)
- On route change: re-publish the audio track or restart audio capture
- Alternatively: detect silence on the agent side and notify the client

---

### BUG-005: Cartesia rejects empty/punctuation-only TTS chunks (LOW)

**First seen:** 19:32:27 UTC
**Frequency:** Intermittent — happens when LLM's first streaming chunk is empty or punctuation

**Log excerpt:**
```
ERROR (1412): Cartesia returned error
    error: "Invalid transcript: Your initial transcript is empty or contains only punctuation."
```

**Analysis:** When the LLM starts a response, the first SSE chunk sometimes contains only punctuation or whitespace. The Cartesia streaming WebSocket rejects this. Subsequent chunks may work, but the first TTS frame is lost, causing a noticeable gap or no audio for short responses.

**Fix direction:** Buffer initial TTS input until a minimum amount of non-punctuation text is available before sending to Cartesia. May already be partially handled by the `BUFFERED_WORDS_COUNT` (8 words) in the Cartesia plugin's sentence tokenizer, but the initial chunk bypass path doesn't benefit from this.

---

### BUG-006: Perceived response latency too high — ~8-10s silence (HIGH/UX)

**First seen:** Throughout session
**Severity:** HIGH — users think the system is broken
**Impact:** ~8-10 seconds of dead silence between user finishing speech and hearing any response

**Measured latency breakdown** (19:27 "Hey there, Fletcher" exchange):
```
+0ms     STT final transcript received
+513ms   End of user turn (EOU detection wait)
+521ms   POST to OpenClaw
+528ms   HTTP 200 OK (SSE stream opened)
+8,520ms First LLM token arrives              ← 8 SECONDS
+8,521ms First content chunk ("Yo! Gl")
+???ms   TTS synthesis (Cartesia WebSocket)
+???ms   Audio playout to client
```

**Key finding:** OpenClaw backend takes ~8 seconds for first token. The voice pipeline itself (STT → EOU → POST → HTTP) is fast (~528ms). TTS adds unknown additional latency on top.

**Updated measurements (with OTel-compatible pipeline metrics):**

After adding three tiers of instrumentation (commit `72443ce`–`30b5896`), we now have precise per-turn latency breakdowns. Data from a live session:

| Turn | User said | fetchLatency | fetchStart→firstChunk | totalStreamDuration | TTS TTFB | TTS duration |
|------|-----------|-------------|----------------------|--------------------|---------| ------------|
| 1 | "Hey there." | 6ms | **17,275ms** | 18,310ms (8 chunks) | 248ms | 8,195ms |
| 2 | "Wait..." | 11ms | interrupted | interrupted | — | — |
| 3 | "implementing anything." | 10ms | **11,356ms** | 11,362ms (2 chunks) | 193ms | 421ms |
| 4 | "Mhmm." | 8ms | — | 506ms (0 chunks) | — | — |

**Key observations from instrumented data:**
- **HTTP fetch is instant** (~6-11ms) — the OpenClaw gateway accepts the connection immediately
- **The bottleneck is 100% backend TTFT** — 11-17 seconds between SSE stream open and first data chunk
- **TTS is fast** — Cartesia TTFB is 193-248ms, well within budget
- **SDK reports `ttftMs: -1`** — the LiveKit SDK can't measure LLM TTFT because OpenClaw's first SSE chunk has empty content (role-only delta), and the SDK only starts the TTFT timer on the first content-bearing chunk. Our Ganglia-level timing (`fetchStart→firstChunk`) captures the real number.
- **`tokensPerSecond: 0`** — the SDK token counting doesn't work with OpenClaw's chunking format. Not a real issue, just means we can't use SDK token metrics.
- **EOU delay is 0ms** — the endpointing timer fires but the SDK reports 0ms, suggesting the turn detection is instant once `speech_final` arrives. The 500ms EOU wait visible in earlier manual measurements comes from the fixed endpointing delay, not the EOU model.

**Evidence of user frustration:**
- `firstFrameFut cancelled before first frame` appears 5+ times — user interrupted before hearing ANY response
- Multiple very short sessions (user gave up and reconnected)

**Proposed improvements (from tester):**

1. **Streaming ASR / early triggering:** Investigate if we can start LLM inference on interim STT transcripts rather than waiting for FINAL_TRANSCRIPT + 500ms EOU. Could shave ~500ms-1s.

2. **Acknowledgment sound (NOT human filler):** Emit an immediate non-verbal audio cue as soon as EOU is detected — the auditory equivalent of a "typing..." indicator. NOT human sounds like "hmm..." (uncanny, misleading). Think:
   - Short mechanical beeps/tones (like iMessage send sound)
   - A subtle chime or pulse (like Siri/Alexa acknowledgment)
   - Possibly a repeating soft pulse pattern (every ~2s) so long waits don't feel dead
   - Gets cut off seamlessly when real TTS audio starts streaming
   - Design goal: honest UI feedback ("heard you, processing") not fake humanness
   - **Needs brainstorming session** to nail down the right sound design

3. **Investigate OpenClaw first-token latency:** 8 seconds for TTFT is very high. Check:
   - What model is OpenClaw using? Is it a large/slow model?
   - Is there cold-start overhead on the OpenClaw side?
   - Can we switch to a faster model for voice (e.g., smaller context, faster inference)?
   - Is the OpenClaw gateway adding overhead before forwarding to the LLM?

4. **Pipeline parallelism:** Currently sequential (STT → EOU → LLM → TTS → audio). Investigate overlapping:
   - Start TTS as soon as first sentence is complete (already using streaming, but verify)
   - Consider speculative TTS on interim transcripts

---

## Notes

- Command phrase: "Peanuts and Watermelons" = instruction from tester
- Services monitored: `livekit`, `voice-agent` (via `docker compose logs -f`)
- The user said "I don't think the open call connection is working" — but the OpenClaw connection IS working (200 OK). The real issue is Cartesia TTS voice not found, so the user hears nothing back and assumes OpenClaw is broken.
