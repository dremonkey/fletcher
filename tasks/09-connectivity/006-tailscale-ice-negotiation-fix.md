# 006-tailscale-ice-negotiation-fix.md

## Problem
Fletcher users reported a connectivity failure when transitioning from Wi-Fi to a 5G mobile network, even with Tailscale active on the device.
- **Symptom:** STT (Speech-to-Text) subtitles ceased to appear after network switch.
- **Symptom:** Closing and reopening the app failed to reconnect to the LiveKit room.
- **Root Cause:** The LiveKit server (running in a Docker container on NixOS) was auto-detecting its local LAN/Wi-Fi IP for ICE candidate advertisements. When the client moved to 5G, it continued trying to reach the server via the unreachable local IP instead of the stable Tailscale IP.

## Fix
The `livekit.yaml` configuration was modified to set `rtc.node_ip` to the server's Tailscale IP. This ensures that the server always advertises a routable address for ICE candidates, regardless of the client's physical network (Wi-Fi, 5G, etc.).

> **Note:** `node_ip` must be nested under the `rtc` section — placing it at the top level causes a config parse error. The earlier attempt using `rtc.external_ip` was also invalid.

### Configuration Changes (`livekit.yaml`)
```yaml
rtc:
  node_ip: 100.87.219.109 # NixOS Tailscale IP
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 60000
  use_external_ip: true
```

## Architectural Note: Why Pinning to a Tailscale IP?
While hardcoding IPs is generally discouraged, pinning the **Tailscale IP** is the recommended "Best Practice" for stable WebRTC (LiveKit) over a mesh VPN:
- **Static Identity:** Tailscale IPs are stable for the life of the device on the tailnet. Unlike LAN IPs (DHCP) or Public IPs (ISP rotation), this virtual IP will not change.
- **ICE Advertisement:** WebRTC's ICE negotiation often defaults to the first interface it finds (usually the local Wi-Fi/Ethernet). By pinning the Tailscale IP, we force the server to advertise a routable address that the client (phone) can reach from any network (5G, coffee shop Wi-Fi, etc.) via the Tailscale tunnel.
- **Knittt Hardware Implications:** For future Knittt/Toch hardware, the pairing process should include a step to automatically detect and pin the Tailscale IP in the hub's configuration. This ensures the "Heirloom Hub" is reachable globally out-of-the-box without manual port forwarding or complex STUN/TURN setups.

## Verification
- [x] Patch `livekit.yaml` with explicit RTC settings.
- [x] Restart `fletcher-livekit-1` container.
- [ ] User test: Transition from Wi-Fi to 5G while active in a session.
- [ ] User test: Reconnect to a session over 5G after an app restart.

## Status
- **Date:** 2026-02-27
- **Assigned:** Glitch
- **Priority:** High
