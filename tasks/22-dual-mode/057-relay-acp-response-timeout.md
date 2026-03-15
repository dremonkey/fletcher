# TASK-057: Relay-Side ACP Response Timeout

**Status:** [ ] Not started
**Priority:** High
**Epic:** 22 (Dual-Mode Architecture)
**Origin:** BUG-010 (field test 2026-03-12, session 4)

## Problem

When the relay sends a `session/prompt` to the ACP subprocess, it waits indefinitely for the JSON-RPC response. If OpenClaw hangs (gateway stuck, tool call never returns, subprocess in bad state), the user sees an endless spinner with no recovery path.

The voice-agent previously had `FLETCHER_BRAIN_MAX_WAIT_MS` (task 039) but it was removed as destructive (TASK-042). The relay has no equivalent timeout either.

## Evidence

```
22:56:27.139  → acp: session/prompt sent (sessionId: f5098261)
              [42+ seconds of silence — no acp_raw_stdout]
22:57:09.311  ← mobile: session_cancel (user hit cancel)
22:57:14.541  ← mobile: session_cancel (user hit cancel again)
              [end of log — no further activity, no recovery]
```

The relay forwarded `session/cancel` notifications, but the subprocess didn't act on them either.

## Requirements

- [ ] Add configurable timeout to `AcpClient.request()` — env var `RELAY_ACP_TIMEOUT_MS` (default: 60000)
- [ ] On timeout, reject the pending request promise with a `TimeoutError`
- [ ] `RelayBridge.handleMobileMessage()` catches `TimeoutError` and sends an error response to mobile
- [ ] After timeout, mark the ACP subprocess as unhealthy — set `needsReinit = true`
- [ ] Mobile should display a user-visible error ("Response timed out — please try again")
- [ ] Ensure `session/cancel` actually interrupts the pending request (if possible via ACP protocol)

## Bonus

- [ ] Add a "heartbeat" check: if ACP subprocess has been silent for N seconds during an active request, log a warning
- [ ] Track consecutive timeouts — if 3 in a row, kill and respawn the subprocess immediately

## Files

- `apps/relay/src/acp/client.ts` — `request()` method needs timeout wrapper
- `apps/relay/src/bridge/relay-bridge.ts` — error handling in `handleMobileMessage()`
- `apps/mobile/lib/services/relay/relay_chat_service.dart` — display timeout error to user

## Related

- Task 039: Brain maxWait Timeout (voice-agent side — already implemented)
- BUG-009 / Task 056: ACP subprocess leak (unhealthy subprocess should be killed, not just flagged)

## Definition of Done

- [ ] Hung ACP responses time out after configurable duration
- [ ] User sees an error message instead of endless spinner
- [ ] Subprocess is marked for re-init after timeout
- [ ] Unit test covering timeout + recovery flow
