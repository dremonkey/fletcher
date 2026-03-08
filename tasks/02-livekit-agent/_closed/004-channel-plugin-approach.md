# Task: Build Fletcher as OpenClaw Channel Plugin

## Description
Convert Fletcher from a standalone agent to an OpenClaw channel plugin, deeply integrating LiveKit voice capabilities into OpenClaw as a native communication channel (like Telegram or WhatsApp).

## Why Channel Plugin?

Building as a channel plugin provides:
- ✅ **Automatic conversation management** - OpenClaw tracks context
- ✅ **Direct access to skills/tools** - No API/MCP overhead
- ✅ **Single deployment** - One service, one config
- ✅ **Access control** - Use OpenClaw's dmPolicy, allowlist
- ✅ **Unified experience** - Consistent with other channels
- ✅ **Community integration** - Becomes part of OpenClaw ecosystem

## Architecture

```
[OpenClaw Gateway] ← Single process
      │
      ├─ [Telegram Channel]
      ├─ [WhatsApp Channel]
      └─ [LiveKit Channel Plugin] ← Fletcher
            │
            ├─ LiveKit Room Connection
            ├─ STT (Deepgram/Groq)
            ├─ TTS (Cartesia/ElevenLabs)
            └─ Audio Pipeline
```

## Plugin Structure

```
@openclaw/channel-livekit/
├── package.json              # Plugin manifest
├── openclaw.plugin.json      # Plugin metadata (optional)
├── README.md
├── src/
│   ├── index.ts             # Plugin entry point
│   ├── channel.ts           # Channel interface implementation
│   ├── livekit/
│   │   ├── connection.ts    # LiveKit room management
│   │   ├── participant.ts   # Participant tracking
│   │   └── audio.ts         # Audio track handling
│   ├── pipeline/
│   │   ├── stt.ts           # Speech-to-text
│   │   ├── tts.ts           # Text-to-speech
│   │   └── buffer.ts        # Audio buffering
│   ├── config.ts            # Configuration schema
│   └── types.ts             # TypeScript types
├── skills/                   # Optional skills
│   └── voice-call/
│       └── SKILL.md
└── tests/
    └── integration.test.ts
```

## Package.json Configuration

```json
{
  "name": "@openclaw/channel-livekit",
  "version": "1.0.0",
  "description": "Real-time voice conversations for OpenClaw via LiveKit",
  "license": "MIT",
  "repository": "dremonkey/openclaw-plugin-livekit",

  "openclaw": {
    "extensions": ["src/index.ts"],
    "channel": {
      "id": "livekit",
      "label": "LiveKit Voice",
      "blurb": "Real-time voice conversations with <1.5s latency"
    }
  },

  "dependencies": {
    "livekit-server-sdk": "^2.0.0",
    "@deepgram/sdk": "^3.0.0",
    "@cartesia/cartesia-js": "^1.0.0"
  },

  "devDependencies": {
    "openclaw": "workspace:*",
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0"
  },

  "peerDependencies": {
    "openclaw": ">=2.0.0"
  }
}
```

## Plugin Entry Point (src/index.ts)

```typescript
import { Type } from '@sinclair/typebox';
import type { ChannelPlugin, PluginAPI } from 'openclaw';
import { LiveKitChannel } from './channel';

export default function(api: PluginAPI): ChannelPlugin {
  return {
    id: 'livekit',
    name: 'LiveKit Voice Channel',
    version: '1.0.0',

    // Configuration schema (TypeBox)
    configSchema: Type.Object({
      enabled: Type.Boolean({ default: false }),

      // LiveKit Server
      url: Type.String({
        default: 'ws://localhost:7880',
        description: 'LiveKit server URL (local or cloud)'
      }),
      apiKey: Type.String({ description: 'LiveKit API key' }),
      apiSecret: Type.String({ description: 'LiveKit API secret' }),
      roomName: Type.String({
        default: 'family-room',
        description: 'Default room name'
      }),

      // Access Control
      dmPolicy: Type.Union([
        Type.Literal('open'),
        Type.Literal('pairing'),
        Type.Literal('allowlist')
      ], { default: 'pairing' }),
      allowFrom: Type.Optional(Type.Array(Type.String())),

      // STT Configuration
      stt: Type.Object({
        provider: Type.Union([
          Type.Literal('deepgram'),
          Type.Literal('groq')
        ], { default: 'deepgram' }),
        apiKey: Type.String(),
        model: Type.Optional(Type.String()),
        language: Type.Optional(Type.String({ default: 'en' }))
      }),

      // TTS Configuration
      tts: Type.Object({
        provider: Type.Union([
          Type.Literal('cartesia'),
          Type.Literal('elevenlabs')
        ], { default: 'cartesia' }),
        apiKey: Type.String(),
        voice: Type.String({ default: 'amber' }),
        model: Type.Optional(Type.String())
      }),

      // Performance
      latencyTarget: Type.Number({
        default: 1500,
        description: 'Target latency in ms'
      })
    }),

    async register(api) {
      const config = api.config.channels.livekit;

      if (!config.enabled) {
        api.log.info('LiveKit channel disabled');
        return;
      }

      // Initialize channel
      const channel = new LiveKitChannel(api, config);

      try {
        // Connect to LiveKit server
        await channel.connect();
        api.log.info(`LiveKit channel connected to ${config.url}`);

        // Register with OpenClaw message router
        api.channels.register('livekit', channel);

        // Handle incoming transcriptions
        channel.on('transcription', async (event) => {
          const { text, userId, participantName } = event;

          api.log.debug(`[${participantName}] ${text}`);

          // Send to OpenClaw core for processing
          await api.gateway.handleMessage({
            channel: 'livekit',
            channelUserId: userId,
            text,
            timestamp: Date.now(),
            metadata: {
              participantName,
              roomName: config.roomName
            }
          });
        });

        // Handle outgoing responses from OpenClaw
        api.on('message:send', async (message) => {
          if (message.channel === 'livekit') {
            await channel.speak(message.text, message.userId);
          }
        });

        // Handle typing indicators
        api.on('typing:start', async (event) => {
          if (event.channel === 'livekit') {
            await channel.startSpeaking(event.userId);
          }
        });

        // Cleanup on shutdown
        api.on('shutdown', async () => {
          await channel.disconnect();
        });

      } catch (error) {
        api.log.error('Failed to initialize LiveKit channel:', error);
        throw error;
      }
    }
  };
}
```

## Channel Implementation (src/channel.ts)

```typescript
import { EventEmitter } from 'events';
import { Room, RoomEvent, Track } from 'livekit-server-sdk';
import type { PluginAPI, ChannelConfig } from 'openclaw';
import { STTService } from './pipeline/stt';
import { TTSService } from './pipeline/tts';

export class LiveKitChannel extends EventEmitter {
  private room: Room;
  private stt: STTService;
  private tts: TTSService;
  private participants = new Map();

  constructor(
    private api: PluginAPI,
    private config: ChannelConfig
  ) {
    super();
  }

  async connect() {
    // Initialize services
    this.stt = new STTService(this.config.stt);
    this.tts = new TTSService(this.config.tts);

    // Connect to LiveKit room
    this.room = new Room();

    await this.room.connect(this.config.url, this.generateToken());

    // Subscribe to participant events
    this.room.on(RoomEvent.ParticipantConnected, this.handleParticipantJoined.bind(this));
    this.room.on(RoomEvent.ParticipantDisconnected, this.handleParticipantLeft.bind(this));
    this.room.on(RoomEvent.TrackSubscribed, this.handleTrackSubscribed.bind(this));
  }

  async handleParticipantJoined(participant) {
    this.api.log.info(`Participant joined: ${participant.identity}`);

    // Check access control
    if (!this.isAllowed(participant.identity)) {
      this.api.log.warn(`Participant ${participant.identity} not allowed`);
      await participant.disconnect();
      return;
    }

    this.participants.set(participant.sid, {
      identity: participant.identity,
      name: participant.name || participant.identity
    });
  }

  async handleTrackSubscribed(track, publication, participant) {
    if (track.kind === Track.Kind.Audio) {
      // Pipe audio to STT
      const stream = track.createStream();

      this.stt.processStream(stream, (transcription) => {
        this.emit('transcription', {
          text: transcription.text,
          userId: participant.identity,
          participantName: participant.name || participant.identity,
          isFinal: transcription.isFinal
        });
      });
    }
  }

  async speak(text: string, userId: string) {
    // Generate TTS audio
    const audioStream = await this.tts.synthesize(text);

    // Publish to LiveKit room
    const track = await this.room.localParticipant.publishAudio(audioStream);

    this.api.log.debug(`Spoke to ${userId}: ${text}`);
  }

  isAllowed(identity: string): boolean {
    const { dmPolicy, allowFrom } = this.config;

    switch (dmPolicy) {
      case 'open':
        return true;
      case 'allowlist':
        return allowFrom?.includes(identity) ?? false;
      case 'pairing':
        // Check if user has been paired (stored in OpenClaw)
        return this.api.gateway.isPaired('livekit', identity);
      default:
        return false;
    }
  }

  async disconnect() {
    await this.room.disconnect();
    this.stt.close();
    this.tts.close();
  }
}
```

## OpenClaw Configuration (openclaw.json)

Users configure the plugin in their `openclaw.json`:

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "botToken": "..."
    },
    "livekit": {
      "enabled": true,
      "url": "ws://localhost:7880",
      "apiKey": "devkey",
      "apiSecret": "secret",
      "roomName": "family-room",
      "dmPolicy": "allowlist",
      "allowFrom": ["user1@example.com", "user2@example.com"],
      "stt": {
        "provider": "deepgram",
        "apiKey": "your-deepgram-key",
        "model": "nova-2",
        "language": "en"
      },
      "tts": {
        "provider": "cartesia",
        "apiKey": "your-cartesia-key",
        "voice": "amber",
        "model": "sonic-english"
      },
      "latencyTarget": 1500
    }
  }
}
```

## Implementation Checklist

### Project Setup
- [ ] Create `@openclaw/channel-livekit` package
- [ ] Initialize TypeScript project with Bun
- [ ] Set up package.json with openclaw.extensions
- [ ] Create plugin structure (src/, tests/)
- [ ] Install dependencies (livekit-server-sdk, etc.)

### Plugin Core
- [ ] Implement plugin entry point (index.ts)
- [ ] Define configuration schema with TypeBox
- [ ] Implement register() function
- [ ] Add OpenClaw API event handlers
- [ ] Implement logging with api.log

### Channel Implementation
- [ ] Create LiveKitChannel class
- [ ] Implement connect() method
- [ ] Handle participant join/leave events
- [ ] Implement audio track subscription
- [ ] Add access control (dmPolicy, allowFrom)
- [ ] Implement speak() method for responses

### STT Integration
- [ ] Create STTService class
- [ ] Implement Deepgram streaming
- [ ] Implement Groq alternative
- [ ] Handle audio buffering
- [ ] Process interim vs final results
- [ ] Add VAD (Voice Activity Detection)

### TTS Integration
- [ ] Create TTSService class
- [ ] Implement Cartesia streaming
- [ ] Implement ElevenLabs alternative
- [ ] Handle audio format conversion
- [ ] Stream audio chunks to LiveKit
- [ ] Optimize for low latency

### OpenClaw Integration
- [ ] Register with OpenClaw channel router
- [ ] Handle incoming messages from OpenClaw
- [ ] Emit transcriptions to OpenClaw core
- [ ] Implement typing indicators
- [ ] Add conversation context tracking
- [ ] Handle multi-participant rooms

### Testing
- [ ] Unit tests for each component
- [ ] Integration test with OpenClaw
- [ ] Test with local LiveKit server
- [ ] Test with LiveKit Cloud
- [ ] Load test with multiple participants
- [ ] Latency benchmarking (<1.5s target)

### Documentation
- [ ] README with installation instructions
- [ ] Configuration guide
- [ ] API documentation
- [ ] Troubleshooting guide
- [ ] Example openclaw.json configs

### Deployment
- [ ] Publish to npm as @openclaw/channel-livekit
- [ ] Create GitHub releases
- [ ] Add to OpenClaw plugin directory
- [ ] Write blog post / announcement
- [ ] Submit to awesome-openclaw-skills

## Development Path

### Phase 1: Prototype (External Agent)
Build standalone agent first to validate:
- LiveKit integration works
- STT/TTS pipeline meets latency target
- Audio quality is acceptable
- Use tasks in `001-init-plugin.md`, `002-audio-pipeline.md`

### Phase 2: Convert to Plugin
Once prototype works:
- Extract into plugin structure
- Implement OpenClaw plugin interface
- Add configuration schema
- Integrate with OpenClaw Gateway

### Phase 3: Polish & Publish
- Add comprehensive tests
- Write documentation
- Publish to npm
- Open source under MIT license

## Success Criteria
- Plugin installs via npm into OpenClaw
- Configuration works via openclaw.json
- Users can voice chat through LiveKit
- Conversations tracked automatically by OpenClaw
- Access control works (dmPolicy)
- Latency consistently <1.5s
- Multiple participants can chat simultaneously
- Plugin listed in OpenClaw ecosystem

## Resources
- [OpenClaw Plugin Guide](https://docs.openclaw.ai/plugin)
- [Creating Custom Plugins](https://deepwiki.com/openclaw/openclaw/10.3-creating-custom-plugins)
- [Telegram Channel Source](https://github.com/openclaw/openclaw) (reference)
- [WhatsApp Integration](https://deepwiki.com/openclaw/openclaw/8.2-whatsapp-integration)
