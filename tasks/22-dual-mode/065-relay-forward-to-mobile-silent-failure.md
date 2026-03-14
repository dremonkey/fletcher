# TASK-065: Fix silent message loss in relay→mobile forwarding path

**Status:** [ ] Not started
**Priority:** High
**Epic:** 22 (Dual-Mode Architecture)
**Origin:** BUG-020 (field test 2026-03-13, 18:51 PDT)

## Problem

Agent messages that are successfully processed by the ACP backend (visible in
OpenClaw web UI) silently fail to reach the mobile client through the relay
bridge. The user has no indication that a response was generated — from their
perspective the agent simply never replied.

This is a **silent data loss** bug. No errors appear in relay logs, no errors
appear on the mobile client, and there is no retry or recovery mechanism.

## Investigation

### Theory 1: Silent error swallowing in `forwardToMobile()` — CONFIRMED

**File:** `apps/relay/src/bridge/relay-bridge.ts:358-364`
```typescript
private forwardToMobile(msg: object): void {
  if (!this.started) return;
  this.sendQueue = this.sendQueue.then(() =>
    this.options.roomManager
      .sendToRoom(this.options.roomName, msg)
      .catch(() => {
        // Room may have disconnected — swallow errors
      })
  );
}
```

The `.catch(() => {})` swallows **all** errors from `sendToRoom()` with zero
logging. If `publishData` throws (room disconnected, ICE failure, data channel
closed), the message is silently lost. The same pattern exists in
`forwardToVoiceAgent()` (lines 341-347).

This is the **primary observability gap**. Even if the root transport failure is
outside our control, we have no way to know it happened.

### Theory 2: `publishData` can hang indefinitely — CONFIRMED

**File:** `node_modules/.bun/@livekit+rtc-node@0.13.24/.../dist/participant.js:84-102`
```javascript
async publishData(data, options) {
  const req = new PublishDataRequest({ ... });
  const res = FfiClient.instance.request({ ... });
  const cb = await FfiClient.instance.waitFor((ev) => {
    return ev.message.case == "publishData" && ev.message.value.asyncId == res.asyncId;
  });
  if (cb.error) throw new Error(cb.error);
}
```

**File:** `node_modules/.bun/@livekit+rtc-node@0.13.24/.../dist/ffi_client.js:48-58`
```javascript
async waitFor(predicate) {
  return new Promise((resolve) => {
    const listener = (ev) => {
      if (predicate(ev)) {
        this.off("ffi_event", listener);
        resolve(ev.message.value);
      }
    };
    this.on("ffi_event", listener);
  });
}
```

`waitFor` has **no timeout**. If the native FFI backend never fires the matching
event (because the WebRTC connection is in a degraded state), the promise hangs
forever. Because `forwardToMobile` uses a serial `sendQueue`, a single hung
`publishData` call **blocks ALL subsequent messages** in the queue indefinitely.

This is the most dangerous failure mode: not just one message lost, but the
entire relay→mobile path permanently frozen with no error, no timeout, no log.

### Theory 3: Zombie room connection — CONFIRMED possible

**File:** `apps/relay/src/livekit/room-manager.ts:176-189`
```typescript
async sendToRoomOnTopic(roomName: string, topic: string, msg: object): Promise<void> {
  const conn = this.rooms.get(roomName);
  if (!conn) {
    throw new Error(`Not connected to room: ${roomName}`);
  }
  await conn.room.localParticipant!.publishData(data, { reliable: true, topic });
}
```

The only validation is `this.rooms.get(roomName)` — checking the Map entry
exists. There is no check of the Room's actual connection state. A zombie Room
object (still in the Map because `RoomEvent.Disconnected` hasn't fired yet) will
accept `publishData` calls that either throw, hang, or "succeed" without
delivery.

The `RoomEvent.Disconnected` handler (line 116-122) cleans up the Map entry, but
there is a window between the transport dying and the event firing where the room
is a zombie.

### Theory 4: Mobile-side silent drop — CONFIRMED possible

**File:** `apps/mobile/lib/services/relay/relay_chat_service.dart:150-160`

The mobile's `handleMessage()` silently drops messages when:
- JSON-RPC decode fails (malformed payload) — no logging
- Response `id` doesn't match `_activeRequestId` — no logging
- No active stream exists (`_activeStream == null`) — no logging

If the relay successfully publishes but timing/ordering causes a mismatch on the
mobile side, the message is silently dropped with no diagnostic information.

### Most likely BUG-020 scenario

Given the same session had BUG-011 (relay disconnect) and BUG-017 (bootstrap
race), the most likely chain of events:

1. Relay's LiveKit room connection degraded (network glitch or ICE failure)
2. `RoomEvent.Disconnected` either hadn't fired yet (zombie) or fired but the
   BUG-011 fix wasn't deployed at that point in the session
3. Mobile sent a chat message → relay received it (subscription still worked)
4. Relay forwarded to ACP → ACP processed → response visible in OpenClaw web UI
5. ACP sent `session/update` + result back to relay via stdout → relay received
6. Relay called `forwardToMobile()` → `publishData()` either:
   - **Threw** → caught and silently swallowed by `.catch(() => {})`
   - **Hung** → `sendQueue` permanently blocked, all subsequent messages lost
   - **"Succeeded"** → data never actually delivered (zombie connection)
7. Mobile never received the message — zero logging on either side

Without server-side logs from the 18:51 timeframe, we cannot distinguish which
of the three `publishData` outcomes occurred. **This is exactly the problem —
the current code makes it impossible to diagnose.**

## Proposed Fix

### Fix 1: Add logging and error tracking to `forwardToMobile()` (CRITICAL)

**File:** `apps/relay/src/bridge/relay-bridge.ts`

Replace the silent `.catch()` with logging and a consecutive-failure counter:

```typescript
private forwardFailures = 0;
private static readonly MAX_CONSECUTIVE_FAILURES = 3;

private forwardToMobile(msg: object): void {
  if (!this.started) return;

  this.log.debug({ event: "forward_to_mobile", msg }, "→ mobile");

  this.sendQueue = this.sendQueue.then(() =>
    this.options.roomManager
      .sendToRoom(this.options.roomName, msg)
      .then(() => {
        this.forwardFailures = 0; // reset on success
      })
      .catch((err: Error) => {
        this.forwardFailures++;
        this.log.error(
          {
            event: "forward_to_mobile_failed",
            error: err.message,
            consecutiveFailures: this.forwardFailures,
            method: (msg as any).method,
          },
          "Failed to forward message to mobile",
        );

        if (this.forwardFailures >= RelayBridge.MAX_CONSECUTIVE_FAILURES) {
          this.log.error(
            { event: "forward_path_dead", consecutiveFailures: this.forwardFailures },
            "Forward path appears dead — too many consecutive failures",
          );
        }
      })
  );
}
```

Apply the same pattern to `forwardToVoiceAgent()`.

### Fix 2: Add timeout to `publishData` calls (CRITICAL)

**File:** `apps/relay/src/livekit/room-manager.ts`

Wrap `publishData` in a timeout to prevent the send queue from hanging:

```typescript
async sendToRoomOnTopic(roomName: string, topic: string, msg: object): Promise<void> {
  const conn = this.rooms.get(roomName);
  if (!conn) {
    throw new Error(`Not connected to room: ${roomName}`);
  }

  const data = Buffer.from(JSON.stringify(msg));
  const PUBLISH_TIMEOUT_MS = 5_000;

  await Promise.race([
    conn.room.localParticipant!.publishData(data, { reliable: true, topic }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(
        `publishData timed out after ${PUBLISH_TIMEOUT_MS}ms (room: ${roomName}, topic: ${topic})`
      )), PUBLISH_TIMEOUT_MS)
    ),
  ]);

  conn.lastActivity = Date.now();
}
```

This ensures that even if the FFI backend hangs, the relay detects the failure
within 5 seconds and the `sendQueue` unblocks.

### Fix 3: Add logging to mobile-side message drops (LOW priority)

**File:** `apps/mobile/lib/services/relay/relay_chat_service.dart`

Add `debugPrint` calls when messages are dropped:

```dart
void handleMessage(List<int> data) {
  final msg = decodeJsonRpc(Uint8List.fromList(data));
  if (msg == null) {
    debugPrint('[RelayChatService] Dropped malformed JSON-RPC message');
    return;
  }

  if (msg is JsonRpcServerNotification && msg.method == 'session/update') {
    _handleSessionUpdate(msg.params);
  } else if (msg is JsonRpcResponse && msg.id == _activeRequestId) {
    _handlePromptResult(msg);
  } else {
    debugPrint('[RelayChatService] Dropped message: '
      'type=${msg.runtimeType} id=${msg is JsonRpcResponse ? msg.id : "n/a"} '
      'activeId=$_activeRequestId');
  }
}
```

## Edge Cases

- **Timeout race with legitimate slow publish:** 5s timeout is generous for a
  data channel publish (typical < 100ms). If LiveKit is legitimately slow, the
  timeout will fire but the publish may still succeed afterward — the mobile
  would receive a duplicate. This is acceptable: duplicate delivery is better
  than zero delivery, and the mobile's `_activeRequestId` matching prevents
  processing stale responses.

- **Consecutive failure counter across room reconnects:** The `forwardFailures`
  counter should be reset when the bridge restarts (it's an instance field, so
  a new bridge instance for a rejoin starts at 0 — correct by construction).

- **Timer leak from `Promise.race` timeout:** The `setTimeout` in the race is
  not cleaned up on successful publish. For correctness, use `AbortSignal` or
  `clearTimeout` on success. In practice, 5s timer leak per message is harmless,
  but worth a TODO.

## Acceptance Criteria

- [ ] `forwardToMobile()` errors are logged with message method and failure count
- [ ] `forwardToVoiceAgent()` errors are logged with the same pattern
- [ ] `publishData` calls time out after 5s instead of hanging forever
- [ ] After 3 consecutive forward failures, an error-level "forward path dead" log emits
- [ ] Unit test: `sendToRoom` rejection is logged (not silently swallowed)
- [ ] Unit test: `sendToRoom` hang (never-resolving promise) times out after 5s
- [ ] Mobile-side: dropped messages produce a `debugPrint` log line
- [ ] Existing tests still pass (`bun test` in `apps/relay`)

## Files

- `apps/relay/src/bridge/relay-bridge.ts` — Fix 1 (logging in forwardToMobile/forwardToVoiceAgent)
- `apps/relay/src/livekit/room-manager.ts` — Fix 2 (publishData timeout)
- `apps/relay/src/bridge/relay-bridge.spec.ts` — Tests for Fix 1
- `apps/relay/src/livekit/room-manager.spec.ts` — Tests for Fix 2
- `apps/mobile/lib/services/relay/relay_chat_service.dart` — Fix 3 (drop logging)

## Related

- BUG-011 / TASK (closed): Relay disconnect recovery — added `RoomEvent.Disconnected` handler
- TASK-057: Relay ACP response timeout — covers the ACP→relay path; this task covers relay→mobile
- BUG-017: Bootstrap race — different failure mode but same session

## Date

2026-03-13
