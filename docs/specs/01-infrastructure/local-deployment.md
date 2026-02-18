# Local LiveKit Deployment (The Sovereign Hub)

This configuration allows the LiveKit server to run entirely on the local metal (Mac Mini / NUC) without requiring the LiveKit Cloud.

## Infrastructure Choice: Docker vs. systemd

**Decision:** Use **Docker** with `network_mode: host`.

**Reasoning:**
- **Performance:** On Linux, Docker runs natively on the host kernel; overhead is negligible for audio streaming.
- **Networking:** `network_mode: host` is mandatory for WebRTC (UDP port range 50000-60000) to avoid complex port mapping.
- **Immutability:** Keeps the host OS (NixOS) clean; dependencies are encapsulated in the container.
- **Maintainability:** Simplifies versioning (image tags) and rollbacks.

---

## 1. `docker-compose.yaml`

```yaml
services:
  livekit:
    image: livekit/livekit-server:latest
    container_name: livekit-server
    restart: unless-stopped
    command: --config /etc/livekit.yaml
    network_mode: host # Required for WebRTC port ranges
    volumes:
      - ./livekit.yaml:/etc/livekit.yaml
    environment:
      - LIVEKIT_KEYS_API_KEY=${LIVEKIT_API_KEY}
      - LIVEKIT_KEYS_API_SECRET=${LIVEKIT_API_SECRET}
```

## 2. `livekit.yaml` (Local-First Config)

```yaml
port: 7880
bind_addresses:
  - ""
rtc:
  port_range_start: 50000
  port_range_end: 60000
  use_external_ip: false # Set to true ONLY if accessing via public IP (non-Tailscale)
  # udp_port: 7882 # Standard for single-port UDP if preferred

keys:
  # The server will use the environment variables from docker-compose

logging:
  level: info
```

## 3. The Tailscale SSL Strategy

Since the Flutter app needs a secure connection to the Hub, we will use Tailscale's built-in Cert feature to provide a valid SSL certificate for your local `tailnet` address (e.g., `hub.tail-xxxx.ts.net`).

### Steps to enable:
1. `tailscale cert hub.tail-xxxx.ts.net` on the Hub.
2. Update the `docker-compose.yaml` to mount these certs.
3. LiveKit will then serve the API over `https://7880` and WebRTC over `wss://7880`.

---
*Created: 2026-02-18*
