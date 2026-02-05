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

### Plugin Package Setup
- [ ] Create plugin package structure in `packages/openclaw-channel-livekit/`
- [ ] Initialize package.json with openclaw.extensions field
  ```json
  {
    "name": "@openclaw/channel-livekit",
    "openclaw": {
      "extensions": ["dist/index.js"],
      "channel": { "id": "livekit", "label": "LiveKit Voice" }
    }
  }
  ```
- [ ] Set up TypeScript configuration (tsconfig.json)
- [ ] Install core dependencies:
  - [ ] `livekit-server-sdk` - LiveKit client SDK
  - [ ] `@sinclair/typebox` - Configuration schema validation
  - [ ] `@deepgram/sdk` - Speech-to-text
  - [ ] `@cartesia/cartesia-js` - Text-to-speech
- [ ] Add OpenClaw as devDependency/peerDependency
  ```json
  {
    "devDependencies": { "openclaw": "workspace:*" },
    "peerDependencies": { "openclaw": ">=2.0.0" }
  }
  ```

### Plugin Entry Point
- [ ] Create src/index.ts as plugin entry point
- [ ] Export plugin function: `export default function(api: PluginAPI)`
- [ ] Define channel plugin interface:
  - [ ] id: 'livekit'
  - [ ] name: 'LiveKit Voice Channel'
  - [ ] configSchema: TypeBox schema for validation
  - [ ] register(api): Plugin initialization function

### Configuration Schema
- [ ] Define TypeBox schema for channel config
  - [ ] enabled: boolean
  - [ ] url: string (LiveKit server URL)
  - [ ] apiKey: string
  - [ ] apiSecret: string
  - [ ] roomName: string
  - [ ] dmPolicy: 'open' | 'pairing' | 'allowlist'
  - [ ] stt: { provider, apiKey, model }
  - [ ] tts: { provider, apiKey, voice }

### Channel Implementation
- [ ] Create src/channel.ts with LiveKitChannel class
- [ ] Implement connect() method
  - [ ] Load config from api.config.channels.livekit
  - [ ] Connect to LiveKit server
  - [ ] Join specified room
  - [ ] Handle connection errors and reconnection
- [ ] Implement participant event handlers:
  - [ ] `participantConnected` - Subscribe to new participant's audio
  - [ ] `participantDisconnected` - Clean up resources
  - [ ] `trackSubscribed` - Start processing audio from track
  - [ ] `trackUnsubscribed` - Stop processing
- [ ] Set bot metadata (name: "OpenClaw Assistant", type: "bot")

### OpenClaw Integration
- [ ] Register channel with OpenClaw:
  - [ ] Call api.channels.register('livekit', channelInstance)
- [ ] Handle incoming transcriptions:
  - [ ] Listen to channel.on('transcription') events
  - [ ] Send to OpenClaw: api.gateway.handleMessage()
  - [ ] Include userId, text, timestamp, metadata
- [ ] Handle outgoing responses:
  - [ ] Listen to api.on('message:send') events
  - [ ] Filter for channel === 'livekit'
  - [ ] Call channel.speak() to generate TTS
- [ ] Handle typing indicators:
  - [ ] Listen to api.on('typing:start') events
  - [ ] Show "speaking" state in LiveKit room

### Audio Track Management
- [ ] Subscribe to audio tracks from human participants
- [ ] Create audio track for bot's responses
- [ ] Publish bot's audio track to room
- [ ] Implement track enable/disable logic

### Access Control
- [ ] Implement isAllowed() method
  - [ ] Check dmPolicy (open/pairing/allowlist)
  - [ ] For allowlist: check config.allowFrom
  - [ ] For pairing: check api.gateway.isPaired()
- [ ] Disconnect unauthorized participants

### Testing
- [ ] Create "Hello World" test:
  - [ ] Plugin loads when OpenClaw starts
  - [ ] Channel joins LiveKit room
  - [ ] Detects human participant
  - [ ] Sends pre-recorded "Hello" audio message
  - [ ] Verifies audio is received by human client
- [ ] Test with both local and cloud LiveKit servers
- [ ] Verify connection resilience (reconnect on disconnect)
- [ ] Test access control (allowlist, pairing)

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
