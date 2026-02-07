# Technical Specification: openclaw-plugin-livekit

## 1. Overview
The `openclaw-plugin-livekit` package is an OpenClaw Channel Plugin designed to provide high-performance, low-latency voice interaction via [LiveKit](https://livekit.io/). It enables OpenClaw agents to participate in LiveKit rooms as real-time voice participants, bridging the gap between standard text-based message routing and high-fidelity audio streams.

**Target Latency:** < 1.5 seconds glass-to-glass (Audio In -> Agent Processing -> Audio Out).

---

## 2. Integration: OpenClaw Channel Interface
The plugin registers a LiveKit channel with the OpenClaw Gateway via the plugin API.

### Plugin Entry Point:
```typescript
// index.ts
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { livekitPlugin } from "./src/channel.js";
import { setLivekitRuntime } from "./src/runtime.js";

const plugin = {
  id: "livekit",
  name: "LiveKit Voice",
  description: "Real-time voice conversations with <1.5s latency",
  configSchema: livekitConfigSchema,  // TypeBox schema
  register(api: OpenClawPluginApi) {
    // Store runtime for later access (messaging, config, etc.)
    setLivekitRuntime(api.runtime);
    api.registerChannel({ plugin: livekitPlugin });
  },
};

export default plugin;
```

### Runtime Access Pattern:
```typescript
// src/runtime.ts
import type { PluginRuntime } from "openclaw/plugin-sdk";

let runtime: PluginRuntime | undefined;

export function setLivekitRuntime(r: PluginRuntime) {
  runtime = r;
}

export function getLivekitRuntime(): PluginRuntime {
  if (!runtime) throw new Error("LiveKit runtime not initialized");
  return runtime;
}
```

### Key Responsibilities:
- **Registration:** Exports plugin object with `register()` method that calls `api.registerChannel()`.
- **Runtime Storage:** Stores `api.runtime` for later access to OpenClaw messaging, config, etc.
- **Message Routing:**
    - Incoming STT results are converted into OpenClaw `Message` objects and routed to the agent.
    - Outgoing text responses from the agent are converted into audio via the TTS pipeline and published to the LiveKit room.
- **Context Management:** Maps LiveKit rooms to OpenClaw conversations (see below).

### Context Management
Each LiveKit room maps to a single OpenClaw conversation (shared context model):

**Mapping:** `roomId` → `conversationId` (1:1)

```
Room "room_abc" → conversationId "conv_xyz"

- User A joins → joins conv_xyz
- User A: "What's the weather?" → added to conv_xyz
- Agent responds → added to conv_xyz (all participants hear)
- User B joins → joins same conv_xyz
- User B: "How about tomorrow?" → added to conv_xyz (agent has full context)
```

**Speaker Attribution:**
- Each STT transcript includes `participantIdentity`
- Messages sent to OpenClaw include speaker metadata
- Agent knows who said what within the shared conversation

**Edge Cases:**
| Scenario | Behavior |
|----------|----------|
| Participant joins late | Joins existing conversation; agent has history, participant does not |
| Participant leaves | Conversation continues with remaining participants |
| Participant rejoins | Resumes same conversation |
| Room empties | Conversation persists; next join resumes it |
| New room | New conversation created |

### ChannelPlugin Implementation:
The channel implements the `ChannelPlugin` interface with adapters:

```typescript
// src/channel.ts
import type { ChannelPlugin } from "openclaw/plugin-sdk";

export const livekitPlugin: ChannelPlugin = {
  id: "livekit",
  meta: {
    label: "LiveKit Voice",
    docsPath: "/docs/channels/livekit",
    icon: "microphone",
  },
  capabilities: {
    chatTypes: ["direct", "channel"],  // Room = channel, 1:1 = direct
    reactions: false,
    threads: false,
    media: false,      // Audio only, no file attachments
    audio: true,       // Voice is the primary modality
    realtime: true,    // Sub-second latency
  },
  config: {
    // Account resolution, listing, etc.
    listAccountIds: (cfg) => listLivekitAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveLivekitAccount({ cfg, accountId }),
    isConfigured: (account) => Boolean(account.url && account.apiKey),
  },
  security: {
    // DM policy (pairing, allowlist, open)
    resolveDmPolicy: ({ account }) => ({
      policy: account.dm?.policy ?? "pairing",
      allowFrom: account.dm?.allowFrom ?? [],
    }),
  },
  gateway: {
    // Lifecycle: start/stop the LiveKit agent worker
    start: async ({ account }) => { /* Connect to LiveKit, start agent */ },
    stop: async ({ account }) => { /* Disconnect, cleanup */ },
  },
  outbound: {
    // Send message → TTS → LiveKit audio track
    send: async ({ target, message }) => {
      await synthesizeAndPublish(target.roomId, message.text);
    },
  },
  messaging: {
    // STT transcription → OpenClaw message
    // (Wired internally via LiveKit agent events)
  },
};
```

### Adapter Summary:
| Adapter | Purpose |
|---------|---------|
| `gateway.start/stop` | Lifecycle: connect/disconnect LiveKit agent worker |
| `outbound.send` | Agent response → TTS → publish audio to room |
| `messaging` | STT transcription → route to OpenClaw brain |
| `config` | Account resolution and configuration |
| `security` | DM policy (pairing, allowlist, open) |
| `capabilities` | Declare channel features (audio, realtime) |

---

## 3. Audio Pipeline: STT/TTS Orchestration
The pipeline uses the `@livekit/agents` framework (Node.js) to orchestrate audio flow. This framework provides built-in support for VAD, interruption handling, and STT/TTS plugin integration.

### Framework: @livekit/agents
- **Runtime:** Node.js (Bun-compatible)
- **Benefits:** Built-in VAD, interruption handling, audio track management, plugin ecosystem
- **Integration:** Wraps the OpenClaw channel logic within a LiveKit Agent worker

### Hybrid VAD Strategy
VAD runs at two layers for optimal latency:

**Client-side VAD (Flutter app):**
- Runs locally on device using Silero VAD or `livekit_client` built-in VAD
- Controls audio track publishing (only transmit when speech detected)
- Sends immediate "user speaking" signal via LiveKit Data Channel
- Enables instant interruption detection without server round-trip

**Server-side VAD (@livekit/agents):**
- Handles utterance boundary detection for STT segmentation
- Acts as fallback if client VAD is unavailable
- Determines when user has finished speaking (end-of-utterance)

**Utterance Segmentation:**
Determines when the user has finished a complete thought and is waiting for a response.
- **Problem:** STT streams words in real-time, but when should we send to the LLM?
  - Too early → cuts off user mid-sentence
  - Too late → unnecessary delay
- **Solution:** Deepgram provides `is_final` and `speech_final` flags:
  - `is_final`: Transcript for this audio segment is complete (but user may continue)
  - `speech_final`: User has stopped speaking (end-of-utterance detected via pause + intonation)
- **Action:** Only route to OpenClaw Brain when `speech_final` is true

### STT (Speech-to-Text)
- **Engine:** Deepgram (Nova-2)
- **Plugin:** `@livekit/agents-plugin-deepgram`
- **Mode:** Streaming with built-in VAD
- **Process:**
    1. LiveKit Agent receives audio from subscribed `AudioTrack`.
    2. Deepgram plugin handles streaming transcription.
    3. VAD determines utterance boundaries automatically.
    4. Final transcript emitted to OpenClaw Gateway.

### TTS (Text-to-Speech)
- **Engines (configurable):**
    - Cartesia (Sonic) - `@livekit/agents-plugin-cartesia` - Default, <200ms TTFB
    - ElevenLabs (Turbo v2.5) - `@livekit/agents-plugin-elevenlabs` - Alternative
- **Mode:** Streaming.
- **Process:**
    1. Receive text response from OpenClaw Brain.
    2. TTS plugin streams text to provider.
    3. Audio chunks automatically published to agent's `AudioTrack`.
    4. Interruption handling managed by framework.

### Voice Configuration
The agent's voice is configured via the plugin `configSchema`:

```json
{
  "tts": {
    "provider": "cartesia",
    "cartesia": {
      "voiceId": "voice_id_here",
      "speed": 1.0,
      "emotion": "neutral"
    },
    "elevenlabs": {
      "voiceId": "voice_id_here",
      "stability": 0.5,
      "similarityBoost": 0.75,
      "style": 0.0,
      "useSpeakerBoost": true
    }
  }
}
```

**Configuration Options:**

| Provider | Option | Type | Description |
|----------|--------|------|-------------|
| Cartesia | `voiceId` | string | Voice ID (pre-made or cloned) |
| Cartesia | `speed` | number | Playback speed multiplier (default: 1.0) |
| Cartesia | `emotion` | string | Emotion preset (e.g., "neutral", "friendly") |
| ElevenLabs | `voiceId` | string | Voice ID from library or cloned |
| ElevenLabs | `stability` | number | Voice consistency, 0-1 (default: 0.5) |
| ElevenLabs | `similarityBoost` | number | Match to original voice, 0-1 (default: 0.75) |
| ElevenLabs | `style` | number | Style exaggeration, 0-1 (default: 0.0) |
| ElevenLabs | `useSpeakerBoost` | boolean | Boost speaker clarity (default: true) |

---

## 4. Room Management
The plugin acts as a "Bot Participant" within LiveKit, managed by the `@livekit/agents` framework.

### LiveKit Agent Lifecycle:
- **Worker:** Runs as a LiveKit Agent worker, automatically handling room connections.
- **Connection:** Agent dispatched to rooms via LiveKit Agent protocol or explicit room join.
- **Participant Tracking:** Framework provides `ParticipantConnected` events to initiate greetings or update conversation context.
- **Track Handling:** Managed automatically by the agents framework:
    - Subscribes to participant `AudioTracks` via agent session.
    - Publishes agent voice via framework's audio output.

### Multi-user Support:
- All participants share a single OpenClaw conversation per room.
- Each participant's audio is processed independently (separate STT streams).
- Speaker identity attached to each transcription for attribution.
- Interruption handling is built into the `@livekit/agents` framework.

---

## 5. Latency Strategy
To achieve the <1.5s target, the following strategies are employed:

1. **Edge VAD for Interruptions:**
   - Client-side VAD detects speech locally with zero latency.
   - Immediate "user speaking" signal stops TTS playback without waiting for server round-trip.
   - Reduces perceived interruption latency from ~200-500ms to <50ms.
2. **Edge-to-Edge Streaming:**
   - No full-buffer waiting. TTS starts as soon as the first few words are generated by the LLM.
   - STT uses WebSocket streaming to process audio in real-time.
3. **Provider Selection:**
   - Use Cartesia for <200ms TTFB (Time To First Byte).
   - Use Deepgram for near-instant transcription.
4. **Transport Optimization:**
   - Utilize UDP/WebRTC via LiveKit for minimal transport jitter.
   - Run the plugin in close proximity to the LiveKit SFU (Selective Forwarding Unit).
5. **Framework Optimization:**
   - `@livekit/agents` handles audio encoding/decoding efficiently.
   - Server-side VAD handles utterance segmentation for STT.

---

## 6. Task Breakdown & Implementation Checklist

### Phase 1: Infrastructure & Agent Setup
- [ ] Initialize `openclaw-plugin-livekit` package with Bun.
- [ ] Install `@livekit/agents`, `@livekit/agents-plugin-deepgram`, `@livekit/agents-plugin-cartesia`, `@livekit/agents-plugin-elevenlabs`.
- [ ] Implement plugin entry point (`index.ts`) with `register()` method.
- [ ] Implement runtime storage pattern (`src/runtime.ts`).
- [ ] Implement `ChannelPlugin` with required adapters (`src/channel.ts`).
- [ ] Define `configSchema` using TypeBox for plugin settings (LiveKit URL, API keys, TTS provider/voice configuration).
- [ ] Implement token endpoint via `api.registerHttpRoute()` for mobile clients to request short-lived access tokens (API secret stays server-side).

### Phase 1.5: Test Infrastructure
- [ ] Set up vitest configuration.
- [ ] Create mock `OpenClawPluginApi` for testing without OpenClaw.
- [ ] Create mock `PluginRuntime` for simulating message routing.
- [ ] Create mock STT/TTS providers for deterministic tests.
- [ ] Write unit tests for plugin registration.

### Phase 2: Audio Inbound (STT)
- [ ] Configure Deepgram plugin with agent worker.
- [ ] Wire STT transcription events to OpenClaw `Message` events.
- [ ] Test VAD and utterance boundary detection.

### Phase 3: Audio Outbound (TTS)
- [ ] Configure Cartesia plugin (default) with agent worker.
- [ ] Add ElevenLabs plugin as configurable alternative.
- [ ] Wire OpenClaw Brain responses to TTS pipeline.
- [ ] Test interruption handling.

### Phase 4: Mobile Client VAD
- [ ] Integrate client-side VAD in Flutter app (Silero VAD or `livekit_client` VAD).
- [ ] Implement audio track muting when no speech detected.
- [ ] Send "user speaking" signal via LiveKit Data Channel.
- [ ] Handle interruption signal from server (stop local TTS playback).

### Phase 5: Refinement & Testing
- [ ] Benchmarking: Measure "Glass-to-Glass" latency.
- [ ] Stability: Handle network reconnects and LiveKit SFU failover.
- [ ] Documentation: Setup guide for Docker-based LiveKit deployment.
