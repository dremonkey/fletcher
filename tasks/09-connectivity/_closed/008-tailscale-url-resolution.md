# 008: Tailscale-Aware URL Resolution

## Status: Complete ✅

## Problem
The TUI rewrites `LIVEKIT_URL` in `apps/mobile/.env` to the dev machine's LAN IP (e.g., `ws://192.168.87.59:7880`). When Tailscale VPN is active on the phone, Android VPN routing blackholes LAN traffic — the app must use the Tailscale IP instead. Previously this required manual switching.

## Solution
TCP race between LAN and Tailscale URLs — whichever connects first wins.

### TUI Side
- `getTailscaleIp()` in `packages/tui/src/mobile.ts` parses `hostname -I` for IPs in the `100.64.0.0/10` CGNAT range
- `updateMobileEnv()` writes `LIVEKIT_URL_TAILSCALE` alongside `LIVEKIT_URL` when a Tailscale IP is found

### Flutter Side
- `url_resolver.dart` — races TCP connections to both LAN and Tailscale URLs; first successful connection wins
- `livekit_service.dart` — resolves URL before every `connect()` call (including reconnects)
- `health_service.dart` — `updateNetworkStatus()` accepts a `warning` parameter for diagnostics

### Evolution
1. **v1 (task 008):** VPN interface detection via `NetworkInterface.list()` — broken on Android 11+ (VPN interfaces hidden from other apps)
2. **v2 (task 018):** "Always use Tailscale URL when configured" — too aggressive, broke LAN-only scenarios
3. **v3 (task 018, current):** TCP race between both URLs — works regardless of VPN state, no detection needed

## Checklist
- [x] TUI: `getTailscaleIp()` + write `LIVEKIT_URL_TAILSCALE` to mobile `.env`
- [x] Flutter: Create `url_resolver.dart` with TCP race resolution
- [x] Flutter: Pass `LIVEKIT_URL_TAILSCALE` through widget tree (main → screen → service)
- [x] Flutter: Resolve URL before every connect/reconnect
- [x] Flutter: Surface diagnostics through health panel
- [x] Architecture doc: `docs/architecture/network-connectivity.md`
- [x] Field tested across LAN and Tailscale scenarios

## Date
- 2026-02-28 (v1 implemented), 2026-03-04 (v2/v3 via task 018)
- **Priority:** Medium
