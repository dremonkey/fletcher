# Task: Implement Audio Pipeline (STT/TTS)

## Description
Build the real-time audio processing pipeline that connects LiveKit audio streams to STT, OpenClaw brain, and TTS services with <1.5s total latency.

## Pipeline Architecture

### End-to-End Flow
```
Human Speech
    ↓
[LiveKit Server] ← WebRTC streams from mobile app
    ↓
[LiveKit Agent] ← Subscribe to audio track
    ↓
[Audio Buffer] ← Accumulate audio chunks
    ↓
[STT Service] ← Deepgram/Groq WebSocket
    ↓
[Text Transcription] ← "What's the weather?"
    ↓
[OpenClaw Gateway] ← Direct internal call (api.gateway.handleMessage)
    ↓
[OpenClaw Core] ← Process with skills, tools, memory
    ↓
[OpenClaw Response] ← Event: message:send
    ↓
[Text Response] ← "It's sunny and 72°F"
    ↓
[TTS Service] ← Cartesia/ElevenLabs streaming API
    ↓
[Audio Response] ← PCM audio chunks
    ↓
[LiveKit Agent] ← Publish to audio track
    ↓
[LiveKit Server] ← Route to human participant
    ↓
Mobile App Playback
```

## Technical Implementation

### 1. Audio Format Handling

LiveKit uses specific audio formats that must match STT/TTS expectations:
- **LiveKit Audio**: 48kHz, 16-bit PCM, mono
- **STT Input**: May require resampling (check provider specs)
- **TTS Output**: May require resampling to 48kHz

### 2. Stream Processing Strategy

#### VAD (Voice Activity Detection)
- Implement VAD to detect when user starts/stops speaking
- Don't send silence to STT (saves API costs)
- Buffer audio until speech ends before processing (or use streaming STT)

#### Buffering Strategy
- **Option A: Streaming** - Send audio chunks to STT as received (lower latency)
- **Option B: Buffered** - Wait for complete utterance (better accuracy)
- Recommend streaming for <1.5s target

### 3. STT Integration (Deepgram/Groq)

#### Deepgram (Recommended for streaming)
- Use WebSocket API for real-time streaming
- Configure interim results for ultra-low latency
- Enable punctuation and formatting

```typescript
// Deepgram streaming configuration
{
  model: 'nova-2',
  encoding: 'linear16',
  sample_rate: 48000,
  channels: 1,
  interim_results: true,
  punctuate: true,
  endpointing: 300  // ms of silence = end of utterance
}
```

#### Groq (Alternative)
- Use Whisper API for high accuracy
- May have slightly higher latency than Deepgram
- Good for complex/accented speech

### 4. OpenClaw Core Integration

The LiveKit channel plugin integrates **directly** with OpenClaw core - no HTTP/MCP needed!

#### Sending Messages to OpenClaw
```typescript
// In channel plugin when transcription is ready
channel.on('transcription', async (event) => {
  const { text, userId, participantName } = event;

  // Send directly to OpenClaw Gateway
  await api.gateway.handleMessage({
    channel: 'livekit',
    channelUserId: userId,
    text,
    timestamp: Date.now(),
    metadata: {
      participantName,
      roomName: config.roomName,
      source: 'voice'
    }
  });
});
```

#### Receiving Responses from OpenClaw
```typescript
// In plugin register() function
api.on('message:send', async (message) => {
  // Filter for messages destined for LiveKit channel
  if (message.channel === 'livekit') {
    // Generate TTS and speak
    await channel.speak(message.text, message.userId);
  }
});

// Handle typing indicators (optional)
api.on('typing:start', async (event) => {
  if (event.channel === 'livekit') {
    // Show "bot is speaking" state
    await channel.startSpeaking(event.userId);
  }
});
```

#### Conversation Context
- **Automatic** - OpenClaw handles all context management
- No need to track conversation history in plugin
- OpenClaw links messages by channelUserId
- Access to full conversation memory, skills, tools
- Multi-participant support built-in

### 5. TTS Integration (Cartesia/ElevenLabs)

#### Cartesia (Recommended for latency)
- Ultra-low latency streaming TTS
- WebSocket streaming API
- First chunk in ~100-200ms

```typescript
// Cartesia streaming configuration
{
  model: 'sonic-english',
  voice: 'amber',  // For "Amber Heartbeat" theme
  output_format: {
    container: 'raw',
    encoding: 'pcm_s16le',
    sample_rate: 48000
  },
  streaming: true
}
```

#### ElevenLabs Turbo (Alternative)
- High quality, good latency
- Streaming API available
- Wider voice selection

### 6. Audio Streaming Back to Room

```typescript
// Publish TTS audio chunks to LiveKit room
for await (const audioChunk of ttsStream) {
  await audioTrack.publishAudio(audioChunk);
}
```

## Latency Optimization

### Target Breakdown (<1.5s total)
- Audio capture → LiveKit → Channel: ~50-100ms
- STT processing: ~200-400ms
- OpenClaw core processing: ~300-500ms ⚡ **No HTTP/MCP overhead**
- TTS generation (first chunk): ~100-200ms
- Audio delivery: ~50-100ms
- **Buffer**: ~200ms for network variance

### Optimization Techniques
1. **Direct Integration**: No HTTP/MCP latency - direct function calls
2. **Parallel Processing**: Start TTS as soon as first sentence is ready
3. **Streaming**: Stream TTS chunks instead of waiting for complete audio
4. **Connection Pooling**: Keep persistent WebSocket connections to STT/TTS
5. **Caching**: Cache common responses if applicable (via OpenClaw)
6. **Interrupt Handling**: Allow users to interrupt bot while speaking

## Implementation Checklist

### STT Integration (Partial)
- [x] Install STT provider SDK (@livekit/agents-plugin-deepgram)
- [x] STTProvider interface (src/pipeline/stt.ts)
- [x] createSTT() factory function
- [x] TranscriptAccumulator for partial/final handling
- [x] shouldRouteToAgent() logic (isFinal && speechFinal)
- [ ] **TODO**: Actual Deepgram WebSocket integration (placeholder exists)
- [ ] Audio buffer management
- [ ] VAD or provider endpointing

### OpenClaw Core Integration ✅
- [x] Implement transcription event handler (VoiceAgent.handleTranscription)
  - [x] Call runtime.gateway.handleMessage()
  - [x] Include channel, conversationId, text, sender
- [x] Implement message send handler (outbound.sendText)
  - [x] Filter for accountId
  - [x] Call agent.say() to generate and play TTS
- [x] State machine for bot state (idle/listening/thinking/speaking)
- [x] Logging via getLivekitLogger()

### TTS Integration (Partial)
- [x] Install TTS provider SDK (@livekit/agents-plugin-cartesia)
- [x] TTSProvider interface (src/pipeline/tts.ts)
- [x] createTTS() factory with Cartesia/ElevenLabs support
- [x] AudioFormat constants and duration calculation
- [ ] **TODO**: Actual Cartesia/ElevenLabs API integration (placeholder exists)
- [ ] Resample audio to 48kHz for LiveKit
- [ ] Streaming buffering for smooth playback

### Audio Track Management (Partial)
- [x] VoiceAgent.say() method for TTS output
- [ ] Create/publish audio track for agent responses
- [ ] Audio format conversion utilities
- [ ] Interrupt detection
- [ ] Graceful audio cutoff

### Latency Monitoring
- [ ] Add timing metrics at each pipeline stage
- [ ] Log latency for each request
- [ ] Implement warning when >1.5s threshold exceeded
- [ ] Create latency dashboard/logging
- [ ] Add OpenTelemetry spans for tracing

### Testing
- [ ] Test with sample audio files
- [ ] Verify end-to-end latency measurement
- [ ] Test with different accents and speech patterns
- [ ] Verify interrupt handling works
- [ ] Test connection failure scenarios
- [ ] Load test with multiple concurrent participants

## Configuration

Configuration is defined in OpenClaw's `openclaw.json`:

```json
{
  "channels": {
    "livekit": {
      "enabled": true,
      "url": "ws://localhost:7880",
      "apiKey": "devkey",
      "apiSecret": "secret",
      "roomName": "family-room",
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
      "performance": {
        "latencyTarget": 1500,
        "audioBufferSize": 100,
        "ttsChunkSize": 4096,
        "maxConcurrentParticipants": 10
      }
    }
  }
}
```

## Success Criteria
- ✅ Complete pipeline processes audio end-to-end
- ✅ Total latency consistently <1.5s (benefiting from direct integration)
- ✅ STT accurately transcribes speech
- ✅ TTS sounds natural and responsive
- ✅ OpenClaw receives and processes messages correctly
- ✅ Responses flow back through TTS to LiveKit
- ✅ Bot can handle interruptions gracefully
- ✅ Multiple participants can interact simultaneously
- ✅ Pipeline recovers from service failures
- ✅ Conversation context maintained by OpenClaw automatically

---

**Technical Spec:** [`docs/specs/02-livekit-agent/spec.md`](../../docs/specs/02-livekit-agent/spec.md)
