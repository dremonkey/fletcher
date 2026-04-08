# Task 102: Fix URL Resolver Fallback Strategy & Sync Network Docs

**Epic:** 09 — Connectivity / Connection Resilience
**Status:** Open
**Priority:** Medium
**Origin:** In-flight WiFi debugging (2026-03-28) — app falls back to unreachable LAN IP when both candidates fail the TCP race

## Problem

When the URL resolver's TCP race times out (all candidates unreachable), it silently
falls back to `candidates.first` — which is always `LIVEKIT_URL` (the LAN IP). This
causes the app to retry indefinitely against an unreachable address with no user feedback.

**Repro:** Airplane mode + in-flight WiFi. Tailscale can't tunnel (airline blocks WireGuard
UDP), LAN IP is unreachable (different network). Both race candidates fail → app falls back
to the LAN IP and loops forever.

The architecture doc (`docs/architecture/network-connectivity.md`) also has several sections
that have drifted from the implementation.

## Scope

### A. Fix URL resolver fallback (code)

**File:** `apps/mobile/lib/services/url_resolver.dart`

1. **Return explicit failure instead of silent fallback.** When all URLs fail the TCP race,
   return `ResolvedUrl(url: '', warning: 'All servers unreachable within ${raceTimeout.inSeconds}s')`
   instead of defaulting to `candidates.first`. Let the caller (`livekit_service.dart`)
   decide how to handle it — show an error, retry with longer timeout, etc.

2. **Surface the warning to the UI.** The `ResolvedUrl.warning` field is already set on
   timeout but never shown to the user. When `resolved.url` is empty or `resolved.warning`
   is non-null, emit a system event so the conversation screen can display "Server
   unreachable" instead of silently retrying.

3. **Consider a longer timeout on retry.** The initial race uses 3s. On the first retry
   after failure, bump to 5s to give Tailscale more time on restrictive networks (hotel
   captive portals, in-flight WiFi with partial VPN support).

4. **Fix potential socket leak.** In `_raceUrls`, if `Future.delayed(timeout)` wins
   `Future.any`, the `tryConnect` futures continue running. Sockets created after the
   cleanup loop won't be destroyed. Add a `_cancelled` flag checked before adding to the
   sockets list, or use a more structured cancellation pattern.

### B. Sync architecture doc with implementation

**File:** `docs/architecture/network-connectivity.md`

| Section | What's wrong | Fix |
|---------|-------------|-----|
| Dynamic Room Names | Says `fletcher-<unix-millis>` | Update to word-pair format: `amber-elm-7x2q` via `NameGenerator` |
| Dynamic Room Names | No mention of session keys | Add: session key format `agent:main:relay:<word-pair>-<YYYYMMDD>` drives room naming |
| Reconnection Flow §2 | Says "Caches `_tailscaleUrl`" | Update to `_allUrls` list (LAN + Tailscale + emulator) |
| Reconnection Flow §5 | Says "Clears `_tailscaleUrl`" | Update to "Clears `_allUrls`" |
| Connection Flow diagram | Shows single token fetch | Update: token service races all candidate hosts in parallel |
| URL Resolution Logic | Only mentions LAN + Tailscale | Add `LIVEKIT_URL_EMULATOR` as third candidate |
| URL Resolution Logic | Fallback says "fall back to LAN URL" | Update to match new behavior (explicit failure) |
| Key Files table | Missing `room_name_generator.dart` | Add entry |

### C. Optional improvements (stretch)

- [ ] **Token fetch host affinity:** After URL race, use the winning host for token fetch
  instead of racing all hosts independently. Avoids fetching token from a different network
  path than the one validated by the URL race.
- [ ] **Configurable race timeout via .env:** Add `URL_RACE_TIMEOUT_S` to `.env` for
  tuning on restrictive networks without rebuilding.

## Acceptance Criteria

- [ ] When all TCP race candidates fail, `resolveLivekitUrl` returns empty URL (not LAN fallback)
- [ ] Caller handles empty URL by showing user-visible "Server unreachable" message
- [ ] Retry attempts use progressively longer timeout (3s → 5s)
- [ ] No socket leak when race times out before all connections complete
- [ ] Architecture doc matches implementation for room names, URL caching, token racing, and emulator URL
- [ ] Sequence diagram updated to show parallel token host racing

## Files to Change

- `apps/mobile/lib/services/url_resolver.dart` — fallback strategy, socket cleanup
- `apps/mobile/lib/services/livekit_service.dart` — handle empty resolved URL, surface warning
- `docs/architecture/network-connectivity.md` — sync all drifted sections

## Related

- Task 018: URL resolver VPN detection (predecessor — introduced the TCP race)
- Task 096: Cold start connection failure (similar: network not ready → bad fallback)
- `docs/architecture/network-connectivity.md` — canonical doc being updated
