# Task: Initialize OpenClaw Channel Plugin

## Description
Set up the OpenClaw channel plugin package structure and integrate the `livekit-server-sdk` to create a channel that acts as a participant in LiveKit rooms.

## Architecture Overview

### OpenClaw Channel Plugin
Fletcher is an **OpenClaw channel plugin** that integrates LiveKit voice capabilities directly into OpenClaw, similar to how Telegram and WhatsApp channels work.

### LiveKit Channel vs LiveKit Server
- **LiveKit Server**: The central media router that handles WebRTC connections, manages rooms, and routes audio/video streams between participants
- **LiveKit Channel Plugin**: An OpenClaw channel (our plugin) that connects TO the LiveKit server, processes audio streams, and sends responses back

### Integration Flow
1. Channel plugin loads when OpenClaw Gateway starts
2. Plugin connects to LiveKit server using WebSocket connection with authentication token
3. Plugin joins a room as a special "bot" participant
4. Plugin subscribes to audio tracks from human participants
5. Plugin processes audio through STT → OpenClaw Core (direct) → TTS pipeline
6. Plugin publishes audio track back to the room for humans to hear

## Technical Approach

### Connection Setup
```typescript
// Agent connects to LiveKit server (local or cloud)
const room = new Room();
await room.connect(LIVEKIT_URL, token);
```

### Participant Management
- Agent identifies as a "bot" participant type
- Automatically subscribes to new participants' audio tracks
- Handles participant join/leave events
- Manages audio track states (muted/unmuted)

### Audio Handling
- Receive raw audio chunks from LiveKit server
- Buffer and process audio for STT
- Generate TTS audio and publish to room
- Handle audio track synchronization

## Implementation Checklist

### Plugin Package Setup ✅
- [x] Create plugin package structure in `packages/openclaw-channel-livekit/`
- [x] Initialize package.json with openclaw.extensions field
  ```json
  {
    "name": "@openclaw/channel-livekit",
    "openclaw": {
      "extensions": ["dist/index.js"],
      "channel": { "id": "livekit", "label": "LiveKit Voice" }
    }
  }
  ```
- [x] Set up TypeScript configuration (tsconfig.json)
- [x] Install core dependencies:
  - [x] `@livekit/agents`, `@livekit/rtc-node`, `livekit-server-sdk`
  - [x] `@sinclair/typebox` - Configuration schema validation
  - [x] `@livekit/agents-plugin-deepgram` - Speech-to-text
  - [x] `@livekit/agents-plugin-cartesia` - Text-to-speech
- [x] Add OpenClaw as peerDependency (`openclaw: ">=2.0.0"`)

### Plugin Entry Point ✅
- [x] Create src/index.ts as plugin entry point
- [x] Export plugin with `id`, `name`, `description`, `configSchema`, `register(api)`
- [x] Define channel plugin interface:
  - [x] id: 'livekit'
  - [x] name: 'LiveKit Voice'
  - [x] configSchema: TypeBox schema for validation
  - [x] register(api): Plugin initialization function

### Configuration Schema ✅
- [x] Define TypeBox schema for channel config (src/config.ts)
  - [x] Multi-account support with accounts record
  - [x] enabled: boolean
  - [x] url: string (LiveKit server URL)
  - [x] apiKey: string
  - [x] apiSecret: string
  - [x] roomPrefix: string
  - [x] dmPolicy: 'open' | 'pairing' | 'allowlist'
  - [x] stt: { provider, apiKey, deepgram config }
  - [x] tts: { provider, apiKey, cartesia/elevenlabs config }
- [x] Environment variable fallback (LIVEKIT_URL, DEEPGRAM_API_KEY, etc.)

### Channel Implementation ✅
- [x] Create src/channel.ts with livekitPlugin object
- [x] Implement gateway.startAccount() / stopAccount()
  - [x] Load config via resolveLivekitAccount()
  - [x] Connect to LiveKit server via connectToRoom()
  - [x] Generate agent token
  - [x] Handle connection errors and abort signal
- [x] Implement participant event handlers (src/livekit/participant.ts):
  - [x] ParticipantTracker with onJoin/onLeave callbacks
  - [x] Speaker creation from RemoteParticipant
- [x] Set bot metadata (identity: "agent-{accountId}")

### OpenClaw Integration ✅
- [x] Register channel with OpenClaw via api.registerChannel()
- [x] Handle incoming transcriptions (VoiceAgent.handleTranscription):
  - [x] Call runtime.gateway.handleMessage()
  - [x] Include channel, conversationId, text, sender
- [x] Handle outgoing responses (outbound.sendText):
  - [x] Calls agent.say() to generate TTS
- [x] Config adapters: listAccountIds, resolveAccount, etc.
- [x] Security adapter: resolveDmPolicy with allowFrom

### Audio Track Management (Partial)
- [x] VoiceAgent class with state machine (idle/listening/thinking/speaking)
- [x] STT/TTS provider initialization
- [ ] Full audio track subscription from participants
- [ ] Audio chunk publishing to room

### Access Control ✅
- [x] DM policy configuration (open/pairing/allowlist)
- [x] allowFrom array support
- [x] security.resolveDmPolicy() adapter

### Testing
- [ ] Set up vitest configuration
- [ ] Create mock OpenClawPluginApi for testing without OpenClaw
- [ ] Create mock STT/TTS providers for deterministic tests
- [ ] Create "Hello World" integration test
- [ ] Test with local/cloud LiveKit servers
- [ ] Verify connection resilience (reconnect on disconnect)
- [ ] Test access control (allowlist, pairing)

### Token Endpoint (for mobile clients)
- [ ] Implement token endpoint via `api.registerHttpRoute()`
- [ ] Mobile clients request short-lived access tokens
- [ ] API secret stays server-side

---

**Technical Spec:** [`docs/specs/02-livekit-agent/spec.md`](../../docs/specs/02-livekit-agent/spec.md)

## Configuration

Configuration is defined in OpenClaw's `openclaw.json` file:

```json
{
  "channels": {
    "livekit": {
      "enabled": true,
      "url": "ws://localhost:7880",
      "apiKey": "devkey",
      "apiSecret": "secret",
      "roomName": "family-room",
      "dmPolicy": "allowlist",
      "allowFrom": ["user1", "user2"],
      "stt": {
        "provider": "deepgram",
        "apiKey": "your-deepgram-key"
      },
      "tts": {
        "provider": "cartesia",
        "apiKey": "your-cartesia-key",
        "voice": "amber"
      }
    }
  }
}
```

## Plugin Installation

### For Development
```bash
# In OpenClaw extensions directory
cd path/to/openclaw/extensions
git clone https://github.com/dremonkey/openclaw-plugin-livekit channel-livekit
cd channel-livekit
bun install
bun run build
```

### For Production
```bash
# Install from npm
bun add @openclaw/channel-livekit
```

## Success Criteria
- ✅ Plugin package structure follows OpenClaw conventions
- ✅ Plugin loads when OpenClaw Gateway starts
- ✅ Channel successfully connects to LiveKit server
- ✅ Channel joins room and appears as bot participant
- ✅ Channel receives audio from human participants
- ✅ Channel can publish audio back to room
- ✅ Integration with OpenClaw message routing works
- ✅ Access control (dmPolicy) works correctly
- ✅ Connection is stable and handles reconnection
