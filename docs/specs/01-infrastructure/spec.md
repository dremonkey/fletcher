# Technical Specification: Infrastructure

## Overview

Fletcher's infrastructure consists of two key components:
1. **LiveKit Server** - Real-time audio/video routing
2. **Monorepo Structure** - Multi-language workspace organization

---

## 1. LiveKit Server

### Purpose
LiveKit serves as the Selective Forwarding Unit (SFU) that routes WebRTC audio streams between the mobile app and the OpenClaw agent.

### Deployment Options

| Option | Use Case | Latency |
|--------|----------|---------|
| Local Docker | Development | ~10ms |
| LiveKit Cloud | Production | ~50-100ms |
| Self-hosted | Enterprise | Varies |

### Docker Compose Configuration

```yaml
version: "3.9"
services:
  livekit:
    image: livekit/livekit-server:latest
    ports:
      - "7880:7880"   # HTTP API
      - "7881:7881"   # RTC (WebRTC)
      - "7882:7882"   # TURN/UDP
    environment:
      - LIVEKIT_KEYS=devkey: secret
    command: --dev --bind 0.0.0.0
```

### Default Development Settings
- **API Key**: `devkey`
- **API Secret**: `secret`
- **URL**: `ws://localhost:7880`
- **Mode**: Development (no TLS required)

---

## 2. Monorepo Structure

### Architecture Decision

Fletcher uses a **package-centric + app-centric hybrid** monorepo pattern:

```
fletcher/
├── packages/                    # Reusable libraries (npm)
│   ├── openclaw-channel-livekit/   # Channel plugin (TypeScript/Bun)
│   └── livekit-agent-ganglia/     # Brain plugin (TypeScript/Bun)
├── apps/                        # Deployable applications
│   └── mobile/                     # Flutter app (Dart)
├── docs/
├── tasks/
└── package.json                 # Workspace root
```

### Why This Structure?

| Directory | Purpose | Package Manager |
|-----------|---------|-----------------|
| `packages/` | Publishable libraries | Bun (npm) |
| `apps/` | Deployable applications | Varies (Flutter uses pub) |

**Key Principle**: Libraries and applications have different lifecycle and distribution needs.

### Multi-Language Support

Fletcher spans two language ecosystems that are managed independently:

| Component | Language | Package Manager | Build Tool |
|-----------|----------|-----------------|------------|
| Channel Plugin | TypeScript | Bun | tsc |
| Brain Plugin | TypeScript | Bun | tsc |
| Mobile App | Dart | pub | Flutter |

### Bun Workspace Configuration

```json
{
  "name": "fletcher",
  "private": true,
  "workspaces": ["packages/*"],
  "bun": {
    "install": {
      "linker": "isolated"
    }
  }
}
```

**Key Settings:**
- `workspaces`: Only includes `packages/*` (not `apps/`)
- `linker: isolated`: Strict dependency isolation (like pnpm)

### Isolated Dependencies

Bun's isolated mode prevents phantom dependencies:

```
node_modules/
├── .bin/
├── express -> .bun/install/cache/...  # Symlink to declared dep
└── ...                                  # Only declared deps accessible
```

**Benefits:**
- Catches missing dependencies early
- Ensures published packages work correctly
- Reproducible builds

### Flutter App Independence

The Flutter app is **NOT** part of the Bun workspace because:
- Flutter uses `pubspec.yaml` + `pub` (Dart ecosystem)
- Bun workspaces only manage JavaScript/TypeScript
- No shared runtime dependencies between ecosystems

---

## 3. Development Workflow

### Initial Setup
```bash
# Clone and install TypeScript dependencies
git clone <repo>
bun install

# Install Flutter dependencies (separate)
cd apps/mobile && flutter pub get
```

### Running Services
```bash
# Start LiveKit server
docker-compose up -d

# Run plugin in watch mode
bun run plugin:dev

# Run Flutter app
cd apps/mobile && flutter run
```

### CI/CD Strategy

Separate workflows with path filters:

```yaml
# .github/workflows/plugin-ci.yml
on:
  push:
    paths: ['packages/**']

# .github/workflows/mobile-ci.yml
on:
  push:
    paths: ['apps/mobile/**']
```

---

## Implementation Status

For task progress, see [`tasks/01-infrastructure/`](../../../tasks/01-infrastructure/).
