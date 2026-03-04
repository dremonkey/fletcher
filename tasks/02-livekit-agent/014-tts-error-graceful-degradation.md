# TASK-014: TTS Error Graceful Degradation

**Status:** `[ ]` RCA COMPLETE — ready to implement
**Priority:** HIGH
**Bug ref:** BUG-024
**Created:** 2026-03-04

## Problem

When TTS hits a 429 rate limit (Gemini 2.5 Flash TTS, 100 req/day free tier), the `AgentSession` dies. The user loses voice interaction even though LLM responses and STT are still working. Text transcriptions were already flowing to the client — only audio synthesis failed.

## Investigation

### Theory 1: SDK marks TTS errors as non-recoverable, killing the session

**Hypothesis:** A single TTS error with `recoverable: false` kills the session immediately.

**Code check:** `AgentSession._onError` (`agent_session.ts:781-806`):
```typescript
_onError(error): void {
    if (this.closingTask || error.recoverable) return;

    if (error.type === 'tts_error') {
      this.ttsErrorCounts += 1;
      if (this.ttsErrorCounts <= this._connOptions.maxUnrecoverableErrors) {
        return;  // <-- TOLERATED up to threshold
      }
    }

    this.logger.error(error, 'AgentSession is closing due to unrecoverable error');
    this.closingTask = (async () => { await this.closeImpl(CloseReason.ERROR, error); })()...
}
```

**Finding:** The SDK already has `maxUnrecoverableErrors` tolerance (default: **3**, from `types.ts:70`). It counts errors and only kills the session when the count exceeds 3. A single error does NOT kill the session.

**Revised question:** Why does the count exceed 3?

### Theory 2: Multiple parallel TTS calls create error multiplication

**Hypothesis:** The `StreamAdapter` splits LLM text into sentences, each triggering a separate TTS API call. When quota is exhausted, ALL sentences fail, each emitting a separate error event.

**Code check:** `ttsNode()` default implementation (`voice/agent.ts:431-480`):
```typescript
async ttsNode(agent, text, _modelSettings) {
    let wrappedTts = activity.tts;
    if (!activity.tts.capabilities.streaming) {
        wrappedTts = new TTSStreamAdapter(wrappedTts, new BasicSentenceTokenizer());
    }
    const stream = wrappedTts.stream({ connOptions });
    stream.updateInputStream(text);
    // ... returns ReadableStream<AudioFrame>
}
```

Google Gemini TTS has `streaming: false` (`gemini_tts.ts:89`), so it's wrapped with `StreamAdapter`. The `StreamAdapterWrapper.run()` (`stream_adapter.ts:57-131`) tokenizes text into sentences:
```typescript
for await (const ev of this.#sentenceStream) {
    task = Task.from(
        (controller) => synthesize(ev.token, task, controller), // one per sentence
        this.abortController,
    );
    tokenCompletionTasks.push(task);
}
```

Each `synthesize()` call creates a new `ChunkedStream` via `this.#tts.synthesize(token, ...)`. All fire their API calls in parallel (the `await prevTask?.result` only gates audio frame processing, not the API call itself).

**Confirmed:** With an LLM response of N sentences, N parallel TTS API calls fire. All N fail with 429. Each emits a separate `tts_error` event.

### Theory 3: Google plugin error handling has a gap

**Hypothesis:** The 429 error doesn't go through proper error conversion, bypassing retry logic.

**Code check:** `ChunkedStream.run()` in `gemini_tts.ts:188-276`:
```typescript
protected async run() {
    // ...
    const responseStream = await this.#tts.client.models.generateContentStream({...}); // LINE 216

    try {                                                    // LINE 222
        for await (const response of responseStream) { ... }
    } catch (error: unknown) {
        // Lines 226-272: converts errors to APIStatusError
        if (err.code === 429) {
            throw new APIStatusError({ ..., retryable: true });
        }
    } finally {
        this.queue.close();
    }
}
```

**Key finding:** `generateContentStream` at line 216 is **OUTSIDE** the try/catch (lines 222-275). When the API returns 429 before any streaming begins, `@google/genai` throws an `ApiError` that escapes `run()` without being converted to a LiveKit `APIStatusError`.

The error reaches `ChunkedStream._mainTaskImpl` (`tts.ts:463-533`):
```typescript
catch (error) {
    if (error instanceof APIError) {   // FALSE — @google/genai ApiError ≠ LiveKit APIError
        // retry logic (never reached)
    } else {
        this.emitError({ error: toError(error), recoverable: false });  // emits immediately
        throw error;
    }
}
```

**Confirmed:** The error bypasses all retry logic because it's not an `instanceof` LiveKit's `APIError`. Each sentence failure emits exactly 1 error event with `recoverable: false`. No retries.

Additionally, the base class constructor (`tts.ts:460`):
```typescript
Promise.resolve().then(() => this.mainTask().finally(() => this.queue.close()));
```
The re-thrown error becomes an **unhandled promise rejection** (no `.catch()`), visible in logs as `ERR_UNHANDLED_ERROR`.

### Theory 4: Error count exceeds threshold quickly

**Confirmed chain:**
1. LLM produces response → SentenceTokenizer splits into N sentences (typically 3-6)
2. Each sentence → `ChunkedStream` → `generateContentStream` → 429 → error outside try/catch
3. Each `_mainTaskImpl` catch → `emitError({ recoverable: false })` on Google TTS EventEmitter
4. `AgentActivity.onModelError` receives each event → `_onError` increments `ttsErrorCounts`
5. After 4th error (> `maxUnrecoverableErrors: 3`): session closes

**Root causes (two independent bugs):**
- **A) Google plugin gap:** `generateContentStream` outside try/catch → 429 bypasses error conversion → no retries, immediate non-recoverable error
- **B) Error multiplication + low threshold:** N parallel sentence failures each emit an error event. Default threshold of 3 is too low for quota exhaustion scenarios (all sentences fail simultaneously).

## Proposed Fix

### Change 1: Set `maxUnrecoverableErrors` high in `agent.ts`

**File:** `apps/voice-agent/src/agent.ts` ~line 176
**Why:** Prevents session death from persistent TTS failures. Text transcription continues flowing.

```typescript
// BEFORE:
const session = new voice.AgentSession({
    vad,
    turnDetection,
    stt,
    tts,
    llm: gangliaLlm,
    voiceOptions: { ... },
});

// AFTER:
const session = new voice.AgentSession({
    vad,
    turnDetection,
    stt,
    tts,
    llm: gangliaLlm,
    voiceOptions: { ... },
    connOptions: {
        // Allow TTS to fail without killing the session.
        // Text transcriptions still flow via agent_transcript events.
        // TTS errors are surfaced to the client as error artifacts. (BUG-024)
        maxUnrecoverableErrors: Infinity,
    },
});
```

### Change 2: Patch the Google TTS plugin to fix the try/catch gap

**File:** Bun patch for `@livekit/agents-plugin-google` (`gemini_tts.ts`)
**Why:** Makes retries work for 429 errors (transient rate limits recover without errors). Eliminates unhandled promise rejections.

```typescript
// BEFORE (gemini_tts.ts:216-222):
const responseStream = await this.#tts.client.models.generateContentStream({...});

try {
    for await (const response of responseStream) {

// AFTER:
try {
    const responseStream = await this.#tts.client.models.generateContentStream({...});

    for await (const response of responseStream) {
```

Move `generateContentStream` inside the try block. Now 429 errors are caught, converted to `APIStatusError({ statusCode: 429, retryable: true })`, and the base class retry logic works:
- Attempt 1: 429 → retry (2s delay)
- Attempt 2: 429 → retry (2s delay)
- Attempt 3: 429 → retry (2s delay)
- Attempt 4: 429 → emit `recoverable: false` after all retries exhausted

### Change 3: Add user-friendly error message in error handler

**File:** `apps/voice-agent/src/agent.ts` ~line 285 (Error event handler)
**Why:** Send a specific, user-friendly message for TTS errors (vs. the raw API error).

```typescript
// In the Error event handler, after the existing publishEvent:
if (err.type === 'tts_error') {
    publishEvent({
        type: 'artifact',
        artifact_type: 'error',
        title: 'Voice Unavailable',
        message: 'Text responses will continue to appear.',
    });
} else {
    publishEvent({
        type: 'artifact',
        artifact_type: 'error',
        title: `${source} Error`,
        message,
    });
}
```

## Why Text Transcription Survives TTS Failure

The pipeline in `agent_activity.ts:1562-1576` tees the LLM text stream:
```typescript
const [ttsTextInput, textOutput] = llmGenData.textStream.tee();
llmOutput = textOutput;
```

One branch feeds TTS (fails), the other feeds text forwarding → transcription output → client. `ReadableStream.tee()` creates independent branches — TTS failure doesn't affect the text branch.

## Edge Cases

1. **All TTS errors tolerated forever?** With `maxUnrecoverableErrors: Infinity`, even genuinely broken TTS (invalid API key) won't kill the session. This is acceptable — text still flows, error artifacts tell the user what's wrong, and the agent stays useful.
2. **Unhandled promise rejections:** The Google plugin fix (Change 2) addresses this. Without the patch, each failed sentence produces an unhandled rejection. Bun logs them but doesn't crash (configured behavior). With the patch, errors go through proper retry → emit → no unhandled rejection.
3. **Agent state stuck in 'thinking'?** When TTS fails, no audio frames are produced, so `firstFrameFut` is rejected and `onFirstFrame` never fires. The agent never transitions to 'speaking'. It stays in 'thinking' until the reply completes, then returns to 'listening'. Not ideal UX, but not broken — the text still reaches the client.
4. **Rate limit recovery:** After 429 quota resets (~22h), the next turn's TTS calls succeed. With the plugin fix, transient 429s are retried automatically. No permanent degradation.
5. **Error event flooding:** With `maxUnrecoverableErrors: Infinity`, errors are still emitted and logged, but they don't close the session. The error handler sends artifacts to the client for each error. With many sentences, this could produce duplicate "Voice Unavailable" artifacts. Consider deduplicating with a debounce in the error handler.

## Acceptance Criteria

- [ ] TTS 429 error does NOT kill the `AgentSession`
- [ ] LLM text responses still reach the client when TTS fails
- [ ] Error artifact "Voice Unavailable" is sent to the client UI
- [ ] STT continues working (user can still speak, agent still hears)
- [ ] On the next turn, TTS is retried (if quota resets, voice returns)
- [ ] No unhandled promise rejections from TTS failures (with plugin patch)

## Files

- `apps/voice-agent/src/agent.ts` — AgentSession constructor (~L176), error handler (~L285)
- `patches/@livekit+agents-plugin-google@1.0.48.patch` — move `generateContentStream` inside try/catch
- `node_modules/.bun/@livekit+agents-plugin-google@1.0.48*/.../@livekit/agents-plugin-google/src/beta/gemini_tts.ts` — the bug (line 216 outside try/catch)
- `node_modules/.bun/@livekit+agents@1.0.48*/.../@livekit/agents/src/voice/agent_session.ts` — `_onError` error counting (line 781)
- `node_modules/.bun/@livekit+agents@1.0.48*/.../@livekit/agents/src/tts/tts.ts` — `ChunkedStream._mainTaskImpl` retry logic (line 463)
