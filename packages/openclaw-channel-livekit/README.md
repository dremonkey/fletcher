# @openclaw/channel-livekit

A real-time voice channel plugin for OpenClaw using [LiveKit](https://livekit.io/). Enables voice conversations with OpenClaw agents targeting sub-1.5 second latency.

## Features

- Real-time voice conversations via WebRTC
- Speech-to-Text via Deepgram (Nova-3)
- Text-to-Speech via Cartesia (Sonic-3) or ElevenLabs
- Automatic turn detection and interruption handling
- Multi-participant room support with speaker attribution
- Environment variable configuration for easy deployment

## Prerequisites

- [Bun](https://bun.sh/) >= 1.0.0
- LiveKit server (cloud or self-hosted)
- Deepgram API key (for STT)
- Cartesia or ElevenLabs API key (for TTS)

## Installation

```bash
# From npm (when published)
bun add @openclaw/channel-livekit

# Or install from source
cd packages/openclaw-channel-livekit
bun install
```

## Configuration

### Environment Variables

The plugin reads credentials from environment variables (recommended for development):

```bash
# Required: LiveKit credentials
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your-api-key
LIVEKIT_API_SECRET=your-api-secret

# Optional: STT/TTS API keys
DEEPGRAM_API_KEY=your-deepgram-key
CARTESIA_API_KEY=your-cartesia-key
ELEVENLABS_API_KEY=your-elevenlabs-key  # Alternative to Cartesia
```

### OpenClaw Config

Alternatively, configure via OpenClaw's config file:

```yaml
channels:
  livekit:
    url: wss://your-project.livekit.cloud
    apiKey: your-api-key
    apiSecret: your-api-secret
    roomPrefix: "openclaw-"  # Optional, default prefix for rooms

    stt:
      provider: deepgram
      apiKey: your-deepgram-key
      deepgram:
        model: nova-3
        language: en

    tts:
      provider: cartesia  # or "elevenlabs"
      apiKey: your-cartesia-key
      cartesia:
        voiceId: your-voice-id
        model: sonic-3
        speed: 1.0
        emotion: neutral

    dm:
      policy: pairing  # "open", "allowlist", or "pairing"
      allowFrom: []
```

### Multi-Account Configuration

For multiple LiveKit accounts:

```yaml
channels:
  livekit:
    accounts:
      production:
        url: wss://prod.livekit.cloud
        apiKey: prod-key
        apiSecret: prod-secret
      staging:
        url: wss://staging.livekit.cloud
        apiKey: staging-key
        apiSecret: staging-secret
```

## Integration with OpenClaw

### Plugin Registration

The plugin auto-registers when installed. OpenClaw discovers it via the `openclaw` field in `package.json`:

```json
{
  "openclaw": {
    "extensions": ["dist/index.js"],
    "channel": {
      "id": "livekit",
      "label": "LiveKit Voice",
      "blurb": "Real-time voice conversations with <1.5s latency"
    }
  }
}
```

### Manual Registration

If needed, register manually:

```typescript
import plugin from "@openclaw/channel-livekit";

// In your OpenClaw setup
openclaw.registerPlugin(plugin);
```

## Architecture

```
Mobile App → LiveKit Server → Plugin
                                ↓
                         STT (Deepgram)
                                ↓
                         OpenClaw Brain
                                ↓
                         TTS (Cartesia)
                                ↓
                         LiveKit Server → Mobile App
```

### Room-to-Conversation Mapping

Each LiveKit room maps 1:1 to an OpenClaw conversation:

- `roomId` = `conversationId`
- All participants share the same conversation context
- Speaker attribution via participant identity

### Audio Pipeline

1. **Inbound**: Participant audio → LiveKit → STT → OpenClaw message
2. **Processing**: OpenClaw brain generates response
3. **Outbound**: Response text → TTS → LiveKit → Participant audio

## Development

### Build

```bash
bun run build
```

### Run Tests

```bash
# Run all tests
bun run test

# Run with watch mode
bun run test:watch

# Run specific test suites
bun run test:unit
bun run test:integration
```

### Test the Agent Standalone

From the repository root:

```bash
# Generate a token for testing
bun run token:generate --room my-test-room

# Run the agent
bun run agent:dev --room my-test-room
```

### Local LiveKit Server

For local development, use Docker:

```bash
# Start local LiveKit server
docker compose up -d

# Server runs at ws://localhost:7880
# API Key: devkey
# API Secret: secret
```

## Testing

### Unit Tests

Unit tests use mocks for all external dependencies:

```typescript
import { createMockPluginApi } from "./test/mocks";
import plugin from "./src/index";

const mockApi = createMockPluginApi({
  config: {
    channels: {
      livekit: {
        url: "ws://localhost:7880",
        apiKey: "devkey",
        apiSecret: "secret",
      },
    },
  },
});

plugin.register(mockApi);
expect(mockApi._getChannel("livekit")).toBeDefined();
```

### Integration Tests

Integration tests use a real LiveKit server (local Docker) with mocked STT/TTS:

```bash
# Start local LiveKit
docker compose up -d

# Run integration tests
bun run test:integration
```

### Available Mocks

- `createMockPluginApi()` - Mock OpenClaw plugin API
- `createMockRuntime()` - Mock plugin runtime with message tracking
- `createMockSTT()` - Mock speech-to-text provider
- `createMockTTS()` - Mock text-to-speech provider
- `createMockLogger()` - Mock logger with log capture

## API Reference

### Exported Types

```typescript
import type {
  LivekitAccountConfig,
  LivekitChannelConfig,
  ResolvedLivekitAccount,
  STTConfig,
  TTSConfig,
  Speaker,
} from "@openclaw/channel-livekit";
```

### Exported Functions

```typescript
import {
  listLivekitAccountIds,
  resolveLivekitAccount,
  isLivekitAccountConfigured,
} from "@openclaw/channel-livekit";
```

## Troubleshooting

### Connection Issues

1. Verify LiveKit credentials in `.env`
2. Check LiveKit server is reachable: `curl https://your-project.livekit.cloud`
3. Ensure room name doesn't contain special characters

### Audio Quality Issues

- Increase buffer size for unstable connections
- Check STT/TTS API key validity
- Monitor latency in LiveKit dashboard

### NixOS Users

For NixOS-specific issues (native modules, library paths), see [docs/nixos-setup.md](../../docs/nixos-setup.md).

## License

MIT

## Contributing

See the main [Fletcher repository](https://github.com/dremonkey/openclaw-plugin-livekit) for contribution guidelines.
