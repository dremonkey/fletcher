# 008: Tailscale-Aware URL Resolution

## Problem
The TUI rewrites `LIVEKIT_URL` in `apps/mobile/.env` to the dev machine's LAN IP (e.g., `ws://192.168.87.59:7880`). When Tailscale VPN is active on the phone, Android VPN routing blackholes LAN traffic — the app must use the Tailscale IP instead. Previously this required manual switching.

## Solution
Runtime detection of Tailscale on the phone + automatic URL selection.

### TUI Side
- `getTailscaleIp()` in `packages/tui/src/mobile.ts` parses `hostname -I` for IPs in the `100.64.0.0/10` CGNAT range
- `updateMobileEnv()` writes `LIVEKIT_URL_TAILSCALE` alongside `LIVEKIT_URL` when a Tailscale IP is found

### Flutter Side
- `url_resolver.dart` — `hasTailscaleInterface()` checks `NetworkInterface.list()` for CGNAT addresses; `resolveLivekitUrl()` returns the correct URL + optional warning
- `livekit_service.dart` — resolves URL before every `connect()` call (including reconnects), surfaces warnings via health service
- `health_service.dart` — `updateNetworkStatus()` accepts a `warning` parameter for Tailscale mismatch diagnostics

### Decision Matrix
| Tailscale on phone? | `LIVEKIT_URL_TAILSCALE` in `.env`? | URL used | Diagnostics |
|---|---|---|---|
| No | N/A | LAN URL | None |
| Yes | Yes | Tailscale URL | None |
| Yes | No | LAN URL (will fail) | Warning in health panel |

## Checklist
- [x] TUI: `getTailscaleIp()` + write `LIVEKIT_URL_TAILSCALE` to mobile `.env`
- [x] Flutter: Create `url_resolver.dart` with `hasTailscaleInterface()` and `resolveLivekitUrl()`
- [x] Flutter: Pass `LIVEKIT_URL_TAILSCALE` through widget tree (main → screen → service)
- [x] Flutter: Resolve URL before every connect/reconnect
- [x] Flutter: Surface Tailscale mismatch warning through health panel
- [x] Architecture doc: `docs/architecture/network-connectivity.md`
- [ ] User test: Tailscale ON + URL available → uses Tailscale URL
- [ ] User test: Tailscale OFF → uses LAN URL
- [ ] User test: Tailscale ON + no URL → warning in health panel
- [ ] User test: Toggle Tailscale mid-session → reconnect picks correct URL

## Status
- **Date:** 2026-02-28
- **Priority:** Medium
