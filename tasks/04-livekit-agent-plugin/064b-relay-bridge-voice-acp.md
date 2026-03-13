# Task 064b: RelayBridge Voice-ACP Handler

**Epic:** 04 — Ganglia / Brain Plugin
**Status:** [x]
**Depends on:** 064a
**Blocks:** 064d

## Goal

Extend `RelayBridge` to handle `voice-acp` data channel messages from the voice-agent, routing them to the shared ACP subprocess and streaming responses back on the `voice-acp` topic. This is the relay-side half of the relay-mediated LLM backend.

## Context

`RelayBridge` (`apps/relay/src/bridge/relay-bridge.ts`) already bridges mobile↔ACP on the `"relay"` topic. It:

- Receives `session/prompt` and `session/cancel` from mobile
- Forwards to `AcpClient` (subprocess)
- Streams `session/update` notifications back to mobile
- Handles ACP subprocess death with lazy re-init

The voice-agent needs the same bridge but on the `"voice-acp"` topic. **Key architectural decisions from review:**

1. **Shared AcpClient** — voice-acp requests use the same AcpClient that serves chat-mode mobile requests. ACP serializes prompts (one at a time), so voice and chat take turns naturally.
2. **Route to originator** — ACP update notifications go back to whichever topic initiated the active request. No mid-stream re-routing on mode switch. The voice-agent already forwards transcripts to mobile via `agent_transcript` events.
3. **Large payload filter** — ACP updates are typically small (streaming chunks). Tool call results may be large. Filter payloads exceeding the data channel limit (~15KB) with clear logging instead of building a chunking protocol.

```
REQUEST FLOW:
  Voice Agent → voice-acp topic → RelayBridge.handleVoiceAcpMessage()
    → ensureAcp() → acpClient.sessionPrompt()
    → ACP session/update notifications
    → route to voice-acp topic (since voice-acp initiated the request)
    → Voice Agent

ROUTING STATE MACHINE:
  idle → mobile prompt received → activeSource = "relay"
  idle → voice-acp prompt received → activeSource = "voice-acp"
  activeSource set → ACP updates routed to activeSource topic
  prompt completes → activeSource = null → idle
```

## Implementation

### 1. Track active request source (`apps/relay/src/bridge/relay-bridge.ts`)

Add a field to track which topic initiated the currently-active ACP request:

```typescript
/** Which data channel topic owns the active ACP request. null = idle. */
private activeRequestSource: "relay" | "voice-acp" | null = null;
```

### 2. Register voice-acp topic handler (`apps/relay/src/bridge/relay-bridge.ts`)

In `start()`, register a second data handler for the `"voice-acp"` topic (using the new per-topic API from 064a):

```typescript
this.options.roomManager.onDataReceived(
  "voice-acp",
  (rn, data, participantIdentity) => {
    if (rn !== roomName) return;
    this.handleVoiceAcpMessage(data, participantIdentity);
  },
);
```

### 3. Implement `handleVoiceAcpMessage()` (`apps/relay/src/bridge/relay-bridge.ts`)

Follows the same pattern as `handleMobileMessage()` but:

- Sets `activeRequestSource = "voice-acp"` before prompt
- Maps `session/message` (voice-acp wire protocol) to `sessionPrompt()` (ACP protocol)
- Routes the JSON-RPC result back via `voice-acp` topic

```typescript
private handleVoiceAcpMessage(data: unknown, _participantIdentity: string): void {
  // Same validation as handleMobileMessage
  // msg.method === "session/message" → ensureAcp() → sessionPrompt()
  // msg.method === "session/cancel" → sessionCancel()
  // Set activeRequestSource = "voice-acp" on prompt
  // Clear activeRequestSource on result/error
}
```

### 4. Route ACP updates by active source (`apps/relay/src/bridge/relay-bridge.ts`)

Refactor the `acpClient.onUpdate()` handler to route based on `activeRequestSource`:

```typescript
this.acpClient.onUpdate((params: SessionUpdateParams) => {
  if (this.activeRequestSource === "voice-acp") {
    this.forwardToVoiceAgent({ jsonrpc: "2.0", method: "session/update", params });
  } else {
    this.forwardToMobile({ jsonrpc: "2.0", method: "session/update", params });
  }
});
```

### 5. Implement `forwardToVoiceAgent()` (`apps/relay/src/bridge/relay-bridge.ts`)

Same pattern as `forwardToMobile()` but uses the `voice-acp` topic:

```typescript
private forwardToVoiceAgent(msg: object): void {
  if (!this.started) return;
  const json = JSON.stringify(msg);

  // Filter large payloads — data channel has ~15KB practical limit.
  // Tool call results may exceed this. Log and drop rather than crash.
  const MAX_PAYLOAD_BYTES = 15_000;
  if (json.length > MAX_PAYLOAD_BYTES) {
    this.log.warn({
      event: "voice_acp_payload_too_large",
      sizeBytes: json.length,
      maxBytes: MAX_PAYLOAD_BYTES,
      method: (msg as any).method,
    }, `Dropping voice-acp message: ${json.length} bytes exceeds ${MAX_PAYLOAD_BYTES} limit`);
    return;
  }

  this.sendQueue = this.sendQueue.then(() =>
    this.options.roomManager
      .sendToRoomOnTopic(this.options.roomName, "voice-acp", msg)
      .catch(() => {})
  );
}
```

### 6. Update `handleMobileMessage()` to set activeRequestSource

Set `activeRequestSource = "relay"` when a mobile prompt is received, clear on completion/error. This ensures the update routing is correct even when mobile and voice requests interleave.

## Not in scope

- Wire protocol changes (session/message vs session/prompt naming) — use ACP's native method names
- Mid-stream re-routing on mode switch — route to originator per architecture decision
- Data channel chunking protocol — filter + log large payloads instead

## Relates to

- [064 — Relay-Mediated LLM Backend](064-relay-llm-backend.md) (parent design doc)
- [064a — RoomManager Multi-Topic Support](064a-relay-room-manager.md) (prerequisite)
- [064c — Ganglia RelayLLM Backend](064c-ganglia-relay-backend.md) (voice-agent consumer)

## Acceptance criteria

- [ ] `RelayBridge` subscribes to `"voice-acp"` topic on start
- [ ] `session/message` on voice-acp → forwarded to AcpClient via `sessionPrompt()`
- [ ] `session/cancel` on voice-acp → forwarded to AcpClient via `sessionCancel()`
- [ ] ACP update notifications routed to `voice-acp` when voice-acp initiated the request
- [ ] ACP update notifications routed to `relay` when mobile initiated the request (existing behavior preserved)
- [ ] Large payloads (>15KB) filtered with warning log including payload size and method
- [ ] `activeRequestSource` cleared on prompt completion and error
- [ ] **Test T4:** voice-acp `session/message` → `acpClient.sessionPrompt()` called with correct params
- [ ] **Test T5:** voice-acp `session/cancel` → `acpClient.sessionCancel()` called
- [ ] **Test T6:** ACP update during voice-acp request → sent on voice-acp topic (not relay)
- [ ] **Test T7:** ACP update during relay request → sent on relay topic (regression test)

<!--
Status key:
  [ ]  pending
  [~]  in progress
  [x]  done
  [!]  failed / blocked
-->
