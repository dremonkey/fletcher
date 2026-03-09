# Task 007: Integration Testing for OpenResponses

**Epic:** 18 - OpenResponses API Integration  
**Status:** [~] Partially Complete (unit tests done, integration tests pending Gateway)
**Depends on:** 006 (Error Handling)

## Objective

Create comprehensive integration tests to verify the OpenResponses API works correctly with the Fletcher voice agent pipeline.

## Test Scenarios

### 1. Basic Request/Response

**Setup:**
- OpenClaw Gateway running with OpenResponses enabled
- Voice agent configured to use `/v1/responses`

**Test:**
1. Send simple text input: `"hello"`
2. Verify `response.created` event received
3. Verify `response.output_text.delta` events received
4. Verify `response.output_text.done` event received
5. Verify `response.completed` event received
6. Verify full text accumulated correctly

**Expected Result:**
- Agent responds with greeting
- All lifecycle events logged
- Session continuity maintained

### 2. Multi-Turn Conversation

**Test:**
1. Send: `"What is 2+2?"`
2. Verify response: `"4"` or similar
3. Send follow-up: `"What about 3+3?"`
4. Verify response uses same session (references previous context)

**Expected Result:**
- Session key derived from `user` field
- Agent remembers conversation history
- No session drops between turns

### 3. Tool Call (Function Calling)

**Test:**
1. Send: `"What's the weather in SF?"`
2. Verify `response.output_item.added` with `type: "function_call"`
3. Send follow-up with `function_call_output`
4. Verify agent incorporates tool result

**Expected Result:**
- Tool call requested correctly
- Tool result processed
- Agent responds with weather info

### 4. Error Handling

**Test A: Rate Limit**
1. Send many rapid requests to trigger 429
2. Verify `RateLimitError` thrown
3. Verify `Retry-After` extracted
4. Verify error artifact sent to client

**Test B: Auth Failure**
1. Use invalid API key
2. Verify 401 response
3. Verify `AuthenticationError` thrown
4. Verify no retry attempted

**Test C: Malformed Request**
1. Send invalid `input` format
2. Verify 400 response
3. Verify error logged

### 5. Stream Interruption

**Test:**
1. Start request, receive some deltas
2. Trigger `AbortSignal`
3. Verify stream stops cleanly
4. Verify no zombie sessions

**Expected Result:**
- Stream cancelled immediately
- No memory leaks
- Next request works normally

### 6. Network Failure

**Test:**
1. Start request
2. Kill Gateway mid-stream
3. Verify network error caught
4. Verify error artifact sent to client
5. Restart Gateway
6. Verify next request succeeds

**Expected Result:**
- Network error handled gracefully
- User informed via artifact
- Session recovers on reconnect

### 7. Session Routing

**Test A: Owner Session**
1. Set `sessionKey: { type: 'owner', key: 'main' }`
2. Verify request uses `x-openclaw-session-key: main` header

**Test B: Guest Session**
1. Set `user: 'fletcher_guest123'`
2. Verify request uses `user` field in body
3. Verify stable session across multiple requests

### 8. Backward Compatibility

**Test:**
1. Use old `chat()` method
2. Verify it still works
3. Switch to `respond()` method
4. Verify same behavior

**Expected Result:**
- Both endpoints produce equivalent results
- No regressions

## Test Implementation

### Setup

```typescript
// tests/integration/openresponses.test.ts

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { OpenClawClient } from '../../src/client';

describe('OpenResponses Integration', () => {
  let client: OpenClawClient;

  beforeAll(() => {
    client = new OpenClawClient({
      baseUrl: process.env.OPENCLAW_GATEWAY_URL || 'http://localhost:8080',
      apiKey: process.env.OPENCLAW_API_KEY,
    });
  });

  it('should complete a basic request', async () => {
    const events: any[] = [];
    
    for await (const event of client.respond({ input: 'hello' })) {
      events.push(event);
    }

    expect(events.some(e => e.event === 'response.created')).toBe(true);
    expect(events.some(e => e.event === 'response.output_text.delta')).toBe(true);
    expect(events.some(e => e.event === 'response.completed')).toBe(true);
  });

  // ... more tests ...
});
```

### CI Integration

Add to GitHub Actions:

```yaml
# .github/workflows/integration-tests.yml
name: Integration Tests

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      openclaw-gateway:
        image: openclaw/gateway:latest
        ports:
          - 8080:8080
        env:
          OPENCLAW_GATEWAY_TOKEN: test-token
          OPENCLAW_HTTP_RESPONSES_ENABLED: true

    steps:
      - uses: actions/checkout@v3
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: bun test:integration
        env:
          OPENCLAW_GATEWAY_URL: http://localhost:8080
          OPENCLAW_API_KEY: test-token
```

## Manual Testing

### Checklist

- [ ] Deploy Gateway with OpenResponses enabled
- [ ] Run voice agent with `USE_OPENRESPONSES=true`
- [ ] Speak: "Hello, how are you?"
- [ ] Verify agent responds normally
- [ ] Check logs for lifecycle events (response.created, response.completed)
- [ ] Speak: "What did I just say?"
- [ ] Verify agent remembers ("You said hello")
- [ ] Kill Gateway mid-response
- [ ] Verify error artifact appears in app
- [ ] Restart Gateway
- [ ] Verify next turn works

## Files Created

- `packages/livekit-agent-ganglia/tests/integration/openresponses.test.ts`
- `.github/workflows/integration-tests.yml` (or update existing)

## Success Criteria

- All integration tests passing
- CI runs tests on every PR
- Manual testing checklist completed
- No regressions from Chat Completions
