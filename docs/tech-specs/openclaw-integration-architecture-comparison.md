# Fletcher Architecture: Three Approaches

This document compares three different architectural approaches for integrating LiveKit voice capabilities with OpenClaw.

## Summary Comparison

| Aspect | External Agent (API/MCP) | OpenClaw Channel Plugin | OpenClaw Tool Plugin |
|--------|-------------------------|------------------------|---------------------|
| **Integration Level** | External client | Deep integration | Medium integration |
| **Complexity** | High (separate service) | Medium (plugin development) | Low (tool only) |
| **Maintenance** | Separate deployment | Single deployment | Single deployment |
| **OpenClaw Access** | Via API/MCP | Direct (internal) | Direct (internal) |
| **Conversation Management** | Manual | Automatic | Manual |
| **Best For** | Standalone service | Primary voice interface | Voice as a feature |

---

## Approach 1: External Agent (HTTP/MCP Client)

### Architecture

```
[LiveKit Server]
      ↓
[Standalone Agent] ← Separate Bun process
      ↓
[STT] Deepgram/Groq
      ↓
[HTTP/MCP Request] → [OpenClaw Server] (http://127.0.0.1:18789)
      ↓
[TTS] Cartesia/ElevenLabs
      ↓
[LiveKit Server]
```

### How It Works
- Fletcher runs as a **separate service** (Bun process)
- Acts as a LiveKit participant and OpenClaw client
- Sends text to OpenClaw via HTTP API or MCP
- Manages its own LiveKit connections

### Pros
✅ **Independent deployment** - Run Fletcher without modifying OpenClaw
✅ **Technology flexibility** - Use any runtime (Bun, Node, etc.)
✅ **Isolated failures** - Fletcher crash doesn't affect OpenClaw
✅ **Multiple instances** - Scale LiveKit agents independently
✅ **Easier initial development** - No OpenClaw internals knowledge needed

### Cons
❌ **Network overhead** - HTTP/MCP calls add latency
❌ **Separate deployment** - Two services to manage
❌ **Manual context management** - Must track userId/conversationId
❌ **Double authentication** - Both LiveKit and OpenClaw tokens
❌ **No OpenClaw features** - Can't use internal hooks, skills, etc.

### Configuration
```bash
# LiveKit
LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...

# OpenClaw
OPENCLAW_GATEWAY_URL=http://127.0.0.1:18789
OPENCLAW_GATEWAY_TOKEN=...

# STT/TTS
DEEPGRAM_API_KEY=...
CARTESIA_API_KEY=...
```

### When to Use
- **You want Fletcher as a standalone product**
- You need to run Fletcher separately from OpenClaw
- You're prototyping and want fast iteration
- You want to use different runtimes/languages

---

## Approach 2: OpenClaw Channel Plugin ⭐ RECOMMENDED

### Architecture

```
[LiveKit Server]
      ↓
[OpenClaw Gateway] ← Single process
      ↓
[LiveKit Channel Plugin] ← channels.livekit
      ↓
[STT] Deepgram/Groq
      ↓
[OpenClaw Core] ← Direct internal routing
      ↓
[TTS] Cartesia/ElevenLabs
      ↓
[LiveKit Channel Plugin]
      ↓
[LiveKit Server]
```

### How It Works
- Fletcher is an **OpenClaw channel** (like WhatsApp, Telegram)
- Lives inside OpenClaw as `@openclaw/channel-livekit`
- Registered in `openclaw.json` under `channels.livekit`
- OpenClaw handles all AI logic, memory, skills
- Plugin handles LiveKit, STT, TTS

### Pros
✅ **Deep integration** - Direct access to OpenClaw internals
✅ **Automatic conversation management** - OpenClaw handles context
✅ **Single deployment** - One process for everything
✅ **Unified configuration** - One `openclaw.json` file
✅ **Access to all OpenClaw features** - Skills, memory, tools, etc.
✅ **Consistent with other channels** - Same patterns as Telegram/WhatsApp
✅ **No network overhead** - Direct function calls
✅ **Automatic access control** - Use OpenClaw's dmPolicy, allowlist, etc.

### Cons
❌ **OpenClaw internals knowledge** - Must understand plugin API
❌ **Tightly coupled** - Plugin version must match OpenClaw
❌ **Can't scale independently** - Scales with OpenClaw Gateway
❌ **OpenClaw crashes affect voice** - Single point of failure

### Plugin Structure

```
@openclaw/channel-livekit/
├── package.json
├── src/
│   ├── index.ts          # Plugin entry point
│   ├── channel.ts        # Channel interface implementation
│   ├── livekit.ts        # LiveKit room management
│   ├── stt.ts            # Speech-to-text
│   └── tts.ts            # Text-to-speech
└── skills/
    └── voice-call/
        └── SKILL.md      # Optional: teach agent about voice
```

### Package.json
```json
{
  "name": "@openclaw/channel-livekit",
  "version": "1.0.0",
  "openclaw": {
    "extensions": ["src/index.ts"],
    "channel": {
      "id": "livekit",
      "label": "LiveKit Voice",
      "blurb": "Real-time voice conversations via LiveKit"
    }
  },
  "dependencies": {
    "livekit-server-sdk": "^2.0.0",
    "@deepgram/sdk": "^3.0.0",
    "@cartesia/cartesia-js": "^1.0.0"
  },
  "devDependencies": {
    "openclaw": "workspace:*"
  }
}
```

### Plugin Implementation
```typescript
// src/index.ts
import type { ChannelPlugin } from 'openclaw';
import { LiveKitChannel } from './channel';

export default function(api: PluginAPI): ChannelPlugin {
  return {
    id: 'livekit',
    name: 'LiveKit Voice Channel',
    configSchema: Type.Object({
      enabled: Type.Boolean({ default: false }),
      url: Type.String({ default: 'ws://localhost:7880' }),
      apiKey: Type.String(),
      apiSecret: Type.String(),
      roomName: Type.String({ default: 'family-room' }),
      stt: Type.Object({
        provider: Type.Union([Type.Literal('deepgram'), Type.Literal('groq')]),
        apiKey: Type.String()
      }),
      tts: Type.Object({
        provider: Type.Union([Type.Literal('cartesia'), Type.Literal('elevenlabs')]),
        apiKey: Type.String(),
        voice: Type.String({ default: 'amber' })
      })
    }),

    async register(api) {
      const channel = new LiveKitChannel(api, api.config.channels.livekit);

      // Connect to LiveKit
      await channel.connect();

      // Register message handler
      api.on('message:send', async (msg) => {
        if (msg.channel === 'livekit') {
          await channel.sendMessage(msg);
        }
      });

      // Handle incoming audio
      channel.on('transcription', async (text, userId) => {
        // Send to OpenClaw core for processing
        await api.gateway.handleMessage({
          channel: 'livekit',
          userId,
          text,
          timestamp: Date.now()
        });
      });

      // Handle outgoing responses
      api.on('response', async (response) => {
        if (response.channel === 'livekit') {
          await channel.speak(response.text, response.userId);
        }
      });
    }
  };
}
```

### Configuration (openclaw.json)
```json
{
  "channels": {
    "livekit": {
      "enabled": true,
      "url": "ws://localhost:7880",
      "apiKey": "your-livekit-key",
      "apiSecret": "your-livekit-secret",
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

### Installation
```bash
# For development
cd openclaw/extensions
git clone https://github.com/dremonkey/openclaw-plugin-livekit channel-livekit

# For production
npm install @openclaw/channel-livekit
```

### When to Use ⭐
- **You want voice as a primary OpenClaw interface**
- You want automatic conversation management
- You want access to all OpenClaw skills/tools
- You want single deployment and configuration
- You're building for the OpenClaw ecosystem

---

## Approach 3: OpenClaw Tool Plugin

### Architecture

```
[OpenClaw Gateway]
      ↓
[OpenClaw Agent] "Call user via LiveKit"
      ↓
[LiveKit Tool Plugin] ← tools.voice_call
      ↓
[LiveKit Server]
```

### How It Works
- Fletcher is an **OpenClaw tool/skill** (not a channel)
- Agent can initiate voice calls when needed
- Useful for "call me" or "voice mode" commands
- Tool handles outbound calls, not continuous listening

### Pros
✅ **Simple integration** - Just a tool, not a full channel
✅ **On-demand voice** - Agent decides when to use voice
✅ **Combines with other channels** - "Call me on LiveKit" from Telegram
✅ **Easier to build** - Less complex than channel plugin

### Cons
❌ **Not always-on** - Can't start conversations via voice
❌ **Agent-initiated only** - User can't just "call" the agent
❌ **Less natural** - Voice is secondary to text
❌ **Limited use case** - Better for notifications than conversations

### Tool Implementation
```typescript
// tools/voice_call.ts
export const voiceCallTool = {
  name: 'voice_call',
  description: 'Initiate a voice call with the user via LiveKit',
  parameters: {
    userId: 'string',
    message: 'string'
  },

  async execute({ userId, message }) {
    // Create LiveKit room
    const room = await createLiveKitRoom();

    // Generate TTS for message
    const audio = await tts.synthesize(message);

    // Call user
    await room.call(userId);
    await room.playAudio(audio);

    // Listen for response
    const response = await room.listenForSpeech();

    return { success: true, response };
  }
};
```

### Skill (SKILL.md)
```markdown
# Voice Call Skill

You can initiate voice calls with users via LiveKit.

## Usage
When a user asks for a voice call or when you need to deliver urgent information:

```
<think>User requested a voice call. I'll use the voice_call tool.</think>
<voice_call>
<userId>user123</userId>
<message>Hi! You asked me to call you about the weather update.</message>
</voice_call>
```

## When to use
- User explicitly asks for a call
- Urgent notifications that need voice
- Multi-modal interactions
```

### When to Use
- You want voice as an **optional feature**, not primary interface
- You want agent-initiated calls only
- You want to add voice to existing text channels
- You're building a notification/alert system

---

## Recommendation: OpenClaw Channel Plugin ⭐

For Fletcher, I recommend **Approach 2: OpenClaw Channel Plugin** because:

1. **Natural voice-first experience** - Users can start conversations via voice
2. **Automatic conversation management** - OpenClaw handles context across messages
3. **Deep integration** - Access to all OpenClaw skills, memory, tools
4. **Consistent architecture** - Same pattern as Telegram, WhatsApp, etc.
5. **Single deployment** - One service, one config file
6. **Community benefit** - Becomes part of OpenClaw ecosystem

### Development Path

1. **Phase 1: External Agent (Prototype)**
   - Build standalone agent first (Approach 1)
   - Validate LiveKit + STT + TTS pipeline
   - Test latency and quality
   - Prove the concept works

2. **Phase 2: Channel Plugin (Production)**
   - Convert to OpenClaw channel plugin (Approach 2)
   - Integrate with OpenClaw Gateway
   - Publish to npm as `@openclaw/channel-livekit`
   - Open source for community

This lets you **iterate fast** with the external agent, then **productionize** as a channel plugin.

---

## References

### OpenClaw Plugin Documentation
- [Official Plugin Guide](https://docs.openclaw.ai/plugin)
- [Extensions and Plugins](https://deepwiki.com/openclaw/openclaw/10-extensions-and-plugins)
- [Creating Custom Plugins](https://deepwiki.com/openclaw/openclaw/10.3-creating-custom-plugins)

### Channel Examples
- [Telegram Channel](https://docs.openclaw.ai/channels/telegram)
- [WhatsApp Integration](https://deepwiki.com/openclaw/openclaw/8.2-whatsapp-integration)
- [Channel Comparison](https://zenvanriel.nl/ai-engineer-blog/openclaw-channel-comparison-telegram-whatsapp-signal/)

### Skills
- [OpenClaw Skills Guide](https://docs.openclaw.ai/tools/skills)
- [Custom Skill Creation](https://zenvanriel.nl/ai-engineer-blog/openclaw-custom-skill-creation-guide/)
- [Awesome OpenClaw Skills](https://github.com/VoltAgent/awesome-openclaw-skills)
- [ClawHub Skill Directory](https://github.com/openclaw/clawhub)
