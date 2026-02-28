# VAD works but no subtitles (STT dies on audio source change)

## Symptoms

- App is connected to the room, agent is present
- VAD indicator shows speech is detected
- No subtitles appear — neither user transcription nor agent response
- Agent logs show `Error in STTStream mainTask:` with an empty error object

## Agent logs

```
INFO:  participantValue.trackPublications
       trackPublications: []
       lengthOfTrackPublications: 0
DEBUG: onTrackSubscribed in _input
       participant: "user-..."

  ... ~20 seconds pass ...

ERROR: Error in STTStream mainTask:
DEBUG: onTrackSubscribed in _input
       participant: "user-..."
WARN:  RoomEvent.TrackSubscribed: Stream source already set
```

Key details:
- The STT error has no message (empty `{}`). This is because the native `AudioStream` from `@livekit/rtc-node` produces a non-serializable error object.
- A second `onTrackSubscribed` fires after the error, but fails with "Stream source already set".

## Root cause

This happens when the audio source changes mid-session — for example, disconnecting Bluetooth headphones while connected to a room.

The failure chain:

1. **Audio source changes.** The phone switches from Bluetooth to the built-in mic. LiveKit drops the old audio track and publishes a new one.

2. **Old `AudioStream` errors out.** The native WebRTC audio stream tied to the old track produces an error. This propagates through `DeferredReadableStream.pump()` → `writer.abort()` → STT's `pumpInput()` catches it and logs `Error in STTStream mainTask:`.

3. **STT pipeline dies permanently.** The Deepgram `SpeechStream` receives no more audio frames. The STT stream is never re-established for the remainder of the session.

4. **New track can't attach.** When the new mic track arrives, `ParticipantAudioInputStream.onTrackSubscribed` calls `closeStream()` then `setSource()`. But `DeferredReadableStream.detachSource()` only releases the reader lock — it doesn't reset `sourceReader`. So `isSourceSet` still returns `true`, and `setSource()` throws `"Stream source already set"`.

5. **VAD still works.** The audio level indicators in the mobile app are computed client-side from the local mic, independent of the agent's STT pipeline. So the user sees speech detection but no transcription.

### The bug in `DeferredReadableStream`

`@livekit/agents` `DeferredReadableStream` (`src/stream/deferred_stream.ts`) does not support source replacement:

```typescript
// detachSource() releases the reader but doesn't clear sourceReader
async detachSource() {
  this.sourceReader!.releaseLock();
  // Missing: this.sourceReader = undefined;
}

// setSource() checks isSourceSet which is still true after detach
setSource(source: ReadableStream<T>) {
  if (this.isSourceSet) {               // ← still true after detach
    throw new Error('Stream source already set');
  }
  // ...
}
```

Even if `sourceReader` were cleared, the `pump()` method's `finally` block closes the writable stream on detach, so subsequent writes from a new source would also fail. The stream is fundamentally one-shot.

## Workaround

**Reconnect after changing audio sources.** If Bluetooth headphones are disconnected (or any other audio source change occurs), leave the room and rejoin. This creates a fresh agent session with a new STT pipeline.

In the mobile app, this means navigating back and reconnecting. Alternatively, ensure audio sources are stable before connecting.

## Triggering scenarios

- Disconnecting Bluetooth headphones/earbuds mid-session
- Connecting Bluetooth audio after already joining a room
- Phone call interrupting the session (audio routing change)
- Plugging in / removing wired headphones
- OS-level audio permission grants mid-session (e.g., Bluetooth permission)

## Verification

After reconnecting, agent logs should show a clean startup:

```
DEBUG: onTrackSubscribed in _input
       participant: "user-..."
```

With no subsequent `Error in STTStream mainTask` or `Stream source already set` warnings. Subtitles should appear within a few seconds of speaking.

## Upstream

This is a limitation in `@livekit/agents` `DeferredReadableStream` — it doesn't support detaching and reattaching audio sources. A proper fix requires the SDK to either recreate the stream pipeline on track change or make `DeferredReadableStream` support source replacement.
