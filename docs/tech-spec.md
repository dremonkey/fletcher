# Tech Spec: OpenClaw LiveKit Plugin & Fletcher App

**Goal:** Create a high-performance voice-first bridge for OpenClaw using LiveKit.

---

## 1. The OpenClaw Channel Plugin (Backend)
- **Type:** OpenClaw Channel Plugin (`@openclaw/channel-livekit`)
- **Runtime:** Bun (TypeScript)
- **Library:** `livekit-server-sdk`
- **Function:**
    - Acts as a channel in OpenClaw Gateway (like Telegram, WhatsApp)
    - Acts as a participant in LiveKit rooms
    - Handles real-time audio streams (STT ➔ OpenClaw Core ➔ TTS)
    - Integrates directly with OpenClaw's message routing and conversation management

## 2. The Fletcher App (Mobile)
- **Framework:** Flutter (Dart).
- **Library:** `livekit_client`.
- **Function:** 
    - Simple, one-button (or no-button) interface to join a family room.
    - Displays voice intensity via the "Amber Heartbeat" visualizer.

## 3. The Audio Pipeline (The <1.5s Pipe)
1. **Mobile App:** Captures audio ➔ Streams to LiveKit Server.
2. **Plugin:** Receives stream ➔ Fast-STT (Deepgram/Groq) ➔ OpenClaw Brain.
3. **Plugin:** Brain Response ➔ Fast-TTS (Cartesia/ElevenLabs Turbo) ➔ LiveKit Server.
4. **Mobile App:** Receives audio stream ➔ Playback.

## 4. Open Source Strategy
- **License:** MIT.
- **Repo:** `dremonkey/openclaw-plugin-livekit`.
- **Contribution:** Provide a `docker-compose` for the LiveKit server to make it plug-and-play for the community.
