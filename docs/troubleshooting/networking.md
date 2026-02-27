# Mobile App → Local LiveKit Server: Networking Guide

Connecting the Flutter mobile app to a LiveKit server running on your dev machine.

## Working Configuration (Tailscale)

The proven path uses **Tailscale** for connectivity. The phone connects to the dev machine's Tailscale IP over `ws://` (cleartext). This works even when the phone is on cellular data.

**Requirements:**
- Tailscale installed on both dev machine and phone, same account
- `network_security_config.xml` allowing cleartext (already added)
- `apps/mobile/.env` pointing to Tailscale IP: `ws://100.87.219.109:7880`

## Quick Diagnosis

| Symptom | Likely cause | Jump to |
|---------|-------------|---------|
| App shows "Connecting..." forever (no error) | Phone can't reach server, or cleartext blocked | [Step 0](#step-0-verify-phone-can-reach-the-server) |
| WebSocket connects but no audio | WebRTC UDP blocked | [Step 3](#step-3-webrtc-udp-connectivity) |
| Works on emulator, fails on physical device | Wrong IP in .env | [Step 2](#step-2-confirm-mobile-env-has-the-right-ip) |

**Key insight:** The LiveKit Flutter SDK's `Room.connect()` will **hang silently** (no error, no timeout) if the server is unreachable. There's no built-in connection timeout. The app shows "Connecting..." forever with no logcat errors.

---

## Step 0: Verify phone can reach the server

This is the most common failure. Before anything else, confirm basic IP connectivity.

**Check what network the phone is on:**

```sh
adb shell ip addr | grep "inet " | grep -v "127.0.0.1"
```

Look for:
- `wlan0` with a `192.168.x.x` IP → phone is on WiFi (LAN might work)
- `rmnet` with a cellular IP → phone is on cellular (LAN won't work, use Tailscale)
- `tun0` with a `100.x.x.x` IP → Tailscale is active

**Ping the dev machine from the phone:**

```sh
# Via LAN
adb shell ping -c 3 <LAN_IP>

# Via Tailscale
adb shell ping -c 3 <TAILSCALE_IP>
```

If LAN ping fails but Tailscale ping succeeds, use the Tailscale IP in `apps/mobile/.env`.

**Test HTTP connectivity to LiveKit:**

```sh
adb shell "echo -e 'GET / HTTP/1.0\r\nHost: <IP>:7880\r\n\r\n' | nc -w 5 <IP> 7880"
# Expected: HTTP/1.0 200 OK
```

**Status:** [x] Phone can reach LiveKit server (via Tailscale)

---

## Step 1: Verify LiveKit is running

**On the dev machine:**

```sh
curl -s http://localhost:7880 && echo "OK"
```

**Check Docker:**

```sh
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep livekit
```

**Check the startup log for networking info:**

```sh
docker logs fletcher-livekit-1 2>&1 | grep "starting LiveKit"
```

Look for `nodeIP` (should be your machine's IP, not Docker bridge `172.x.x.x`) and `rtc.portICERange`.

**Status:** [x] LiveKit running and responding

---

## Step 2: Confirm mobile .env has the right IP

The TUI (`packages/tui/src/mobile.ts`) rewrites `localhost` → LAN IP automatically. But if the phone is on cellular, you need the Tailscale IP instead.

```sh
cat apps/mobile/.env
```

For Tailscale:
```
LIVEKIT_URL=ws://100.87.219.109:7880
LIVEKIT_TOKEN=eyJ...
```

For LAN (phone on same WiFi):
```
LIVEKIT_URL=ws://192.168.87.59:7880
LIVEKIT_TOKEN=eyJ...
```

**Check token expiry:**

```sh
echo "<TOKEN>" | cut -d. -f2 | base64 -d 2>/dev/null | python3 -m json.tool
# Look at "exp" field, compare to: date +%s
```

**Status:** [x] Mobile .env has correct IP and valid token

---

## Step 3: WebRTC UDP connectivity

LiveKit uses WebSocket for signaling but **audio travels over UDP** (WebRTC). The WebSocket connecting is necessary but not sufficient — UDP must flow too.

### Docker networking

The `docker-compose.yml` uses port mapping (`ports:`). LiveKit inside the container reports `nodeIP: 172.19.0.2` (Docker bridge) and uses ICE port range 50000-60000 by default.

**Current ports mapped:** 7880 (TCP), 7881 (TCP), 7882 (UDP)

**Issue:** The 50000-60000 UDP range is NOT mapped. However, with Tailscale, the ICE negotiation can sometimes succeed via the mapped 7882 port or TURN fallback.

**If WebRTC fails (WebSocket connects but no audio):**

Option A — Switch to `network_mode: host` (recommended for local dev):
```yaml
services:
  livekit:
    image: livekit/livekit-server:latest
    command: --config /etc/livekit.yaml
    network_mode: host
    volumes:
      - ./livekit.yaml:/etc/livekit.yaml
```

Option B — Map the full port range:
```yaml
ports:
  - "7880:7880"
  - "7881:7881"
  - "50000-60000:50000-60000/udp"
```

**Status:** [x] WebRTC connected (ICE candidates gathered, connection established via Tailscale)

---

## Step 4: Android cleartext policy

Android 9+ blocks cleartext HTTP/WebSocket (`ws://`) by default. Without explicit config, `Room.connect()` to a `ws://` URL will **hang silently** — no error, no timeout, no logcat output.

### Fix (already applied)

**`apps/mobile/android/app/src/main/res/xml/network_security_config.xml`:**

```xml
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="true" />
</network-security-config>
```

**`AndroidManifest.xml`** — add `android:networkSecurityConfig` to `<application>`:

```xml
<application
    android:label="fletcher"
    android:name="${applicationName}"
    android:icon="@mipmap/ic_launcher"
    android:networkSecurityConfig="@xml/network_security_config">
```

**Note:** For production, restrict cleartext to specific domains instead of allowing it globally.

**Status:** [x] Cleartext traffic allowed

---

## Step 5: End-to-end verification

1. **Start the stack:**
   ```sh
   docker compose up -d livekit voice-agent
   ```

2. **Generate a fresh token:**
   ```sh
   bun run scripts/generate-token.ts --room fletcher-dev
   ```

3. **Verify the mobile .env** has the right IP (Tailscale or LAN).

4. **Deploy and watch logs:**
   ```sh
   # Terminal 1: LiveKit server logs
   docker logs -f fletcher-livekit-1

   # Terminal 2: Deploy the app
   cd apps/mobile && flutter run -d <device-serial>
   ```

5. **What success looks like in flutter run output:**
   ```
   I/flutter: [Fletcher] Connecting to ws://100.87.219.109:7880
   D/FlutterWebRTCPlugin: onIceGatheringChangeGATHERING
   D/FlutterWebRTCPlugin: onConnectionChangeCONNECTING
   D/FlutterWebRTCPlugin: onIceGatheringChangeCOMPLETE
   I/flutter: Participant connected: agent-AJ_xxxxx
   D/FlutterWebRTCPlugin: onConnectionChangeCONNECTED
   I/flutter: [Fletcher] Connected to room
   I/flutter: Subscribed to audio track
   ```

**Status:** [x] Mobile app connects and audio flows

---

## Tailscale Setup (recommended)

Tailscale is the easiest path for physical device testing. It works across networks (WiFi, cellular, different offices) without firewall or port-forwarding concerns.

### Current setup

| Device | Tailscale IP | Status |
|--------|-------------|--------|
| nixos (dev machine) | 100.87.219.109 | Online |
| pixel-9 (phone) | 100.109.35.114 | Online |

### Using Tailscale (ws://, current)

Set `apps/mobile/.env`:
```
LIVEKIT_URL=ws://100.87.219.109:7880
```

Requires `network_security_config.xml` for cleartext `ws://`.

### Upgrading to wss:// (optional, removes cleartext dependency)

1. **Generate a TLS cert:**
   ```sh
   tailscale cert nixos.tail-xxxx.ts.net
   ```

2. **Configure LiveKit for TLS** in `livekit.yaml`:
   ```yaml
   tls:
     cert_file: /etc/livekit/nixos.tail-xxxx.ts.net.crt
     key_file: /etc/livekit/nixos.tail-xxxx.ts.net.key
   ```

3. **Mount certs in Docker:**
   ```yaml
   volumes:
     - ./livekit.yaml:/etc/livekit.yaml
     - /path/to/certs:/etc/livekit:ro
   ```

4. **Update mobile .env:**
   ```
   LIVEKIT_URL=wss://nixos.tail-xxxx.ts.net:7880
   ```

With `wss://`, the `network_security_config.xml` is no longer needed.

---

## LAN Setup (when phone is on same WiFi)

If the phone is on the same WiFi network as the dev machine:

1. Find dev machine LAN IP: `hostname -I | awk '{print $1}'`
2. Set `apps/mobile/.env`: `LIVEKIT_URL=ws://<LAN_IP>:7880`
3. Ensure `network_security_config.xml` allows cleartext
4. Check firewall allows ports 7880 (TCP) and 7882 + 50000-60000 (UDP)

The TUI auto-rewrites `localhost` → LAN IP when deploying to a physical device.

---

## Progress Log

| Date | Step | Result | Notes |
|------|------|--------|-------|
| 2026-02-27 | Step 1: localhost TCP | PASS | `curl http://localhost:7880` returns 200 |
| 2026-02-27 | Step 1: LAN IP TCP | PASS | `curl http://192.168.87.59:7880` returns 200 |
| 2026-02-27 | Step 1: Tailscale TCP | PASS | `curl http://100.87.219.109:7880` returns 200 |
| 2026-02-27 | Step 0: Phone ping LAN | FAIL | `adb shell ping 192.168.87.59` → 100% packet loss. Phone on cellular, not WiFi |
| 2026-02-27 | Step 0: Phone ping Tailscale | PASS | `adb shell ping 100.87.219.109` → 61-418ms RTT |
| 2026-02-27 | Step 0: Phone HTTP Tailscale | PASS | `nc` to 100.87.219.109:7880 → HTTP 200 |
| 2026-02-27 | Step 4: Cleartext config | DONE | Added `network_security_config.xml` + AndroidManifest reference |
| 2026-02-27 | Step 2: .env update | DONE | Changed `LIVEKIT_URL=ws://100.87.219.109:7880` |
| 2026-02-27 | Step 5: E2E connect | PASS | WebSocket connected, ICE gathered, agent joined, audio track subscribed |
| 2026-02-27 | Observation | NOTE | LiveKit nodeIP=172.19.0.2 (Docker bridge) — may need `network_mode: host` for LAN |
| 2026-02-27 | Observation | NOTE | LiveKit SDK `Room.connect()` hangs silently on unreachable URLs (no timeout) |
