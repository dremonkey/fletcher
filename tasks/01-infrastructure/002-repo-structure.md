# Task: Repository Structure & CI/CD

## Description
Set up the monorepo structure for the OpenClaw channel plugin and Flutter app, following OpenClaw plugin conventions.

## Architecture Decision
Fletcher will be built as an **OpenClaw Channel Plugin** (`@openclaw/channel-livekit`), not a standalone service. This provides:
- Deep integration with OpenClaw
- Automatic conversation management
- Single deployment
- Access to all OpenClaw features

## Monorepo Structure

```
fletcher/
├── packages/
│   ├── openclaw-channel-livekit/     # OpenClaw channel plugin (npm package)
│   │   ├── package.json              # @openclaw/channel-livekit
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts              # Plugin entry point
│   │   │   ├── channel.ts            # Channel implementation
│   │   │   ├── config.ts             # Configuration schema
│   │   │   ├── livekit/
│   │   │   │   ├── connection.ts     # LiveKit room management
│   │   │   │   ├── participant.ts    # Participant handling
│   │   │   │   └── audio.ts          # Audio track management
│   │   │   ├── pipeline/
│   │   │   │   ├── stt.ts            # Speech-to-text
│   │   │   │   ├── tts.ts            # Text-to-speech
│   │   │   │   └── buffer.ts         # Audio buffering
│   │   │   └── types.ts              # TypeScript types
│   │   ├── skills/                   # Optional OpenClaw skills
│   │   │   └── voice-call/
│   │   │       └── SKILL.md
│   │   ├── tests/
│   │   │   ├── unit/
│   │   │   └── integration/
│   │   └── README.md
│   │
│   └── fletcher-app/                 # Flutter mobile app
│       ├── pubspec.yaml
│       ├── lib/
│       │   ├── main.dart
│       │   ├── screens/
│       │   │   └── home_screen.dart
│       │   ├── services/
│       │   │   └── livekit_service.dart
│       │   └── widgets/
│       │       └── amber_heartbeat.dart
│       ├── test/
│       └── README.md
│
├── docs/
│   ├── tech-spec.md
│   ├── architecture-comparison.md
│   └── setup-guide.md
│
├── tasks/                            # Project roadmap
│   ├── 01-infrastructure/
│   ├── 02-livekit-agent/
│   └── 03-flutter-app/
│
├── examples/                         # Example configurations
│   ├── openclaw.json                 # Example OpenClaw config
│   └── docker-compose.yml            # LiveKit server
│
├── .github/
│   └── workflows/
│       ├── plugin-ci.yml             # CI for plugin
│       └── app-ci.yml                # CI for Flutter app
│
├── package.json                      # Workspace root
├── pnpm-workspace.yaml               # pnpm workspaces config
├── tsconfig.base.json                # Shared TypeScript config
├── .gitignore
├── LICENSE
└── README.md
```

## Package Manager: pnpm

Using pnpm for better monorepo support:
- Efficient disk space usage
- Strict dependency resolution
- Better workspace support than npm/yarn

## Implementation Checklist

### Monorepo Setup
- [ ] Initialize git repository
- [ ] Create monorepo structure with packages/ directory
- [ ] Set up pnpm workspaces
- [ ] Create root package.json with workspace configuration
- [ ] Create .gitignore (node_modules, .env, etc.)

### OpenClaw Plugin Package
- [ ] Create packages/openclaw-channel-livekit/
- [ ] Initialize package.json with openclaw.extensions
- [ ] Set up TypeScript configuration
- [ ] Create src/ directory structure
- [ ] Add dependencies (livekit-server-sdk, etc.)
- [ ] Set up ESLint + Prettier for TypeScript
- [ ] Create README.md with installation guide

### Flutter App Package
- [ ] Create packages/fletcher-app/
- [ ] Initialize Flutter project (flutter create)
- [ ] Add livekit_client dependency
- [ ] Set up directory structure (screens, services, widgets)
- [ ] Configure Flutter linting (analysis_options.yaml)
- [ ] Create README.md with setup instructions

### Shared Configuration
- [ ] Create tsconfig.base.json for shared TS settings
- [ ] Set up shared ESLint config
- [ ] Set up shared Prettier config
- [ ] Create .editorconfig for consistent formatting

### Documentation
- [ ] Move docs/ to root level
- [ ] Create setup-guide.md with full instructions
- [ ] Document plugin installation process
- [ ] Document Flutter app setup
- [ ] Add contribution guidelines

### Examples
- [ ] Create examples/ directory
- [ ] Add example openclaw.json configuration
- [ ] Add docker-compose.yml for LiveKit server
- [ ] Add example .env file (with placeholders)

### CI/CD (GitHub Actions)
- [ ] Create .github/workflows/ directory
- [ ] Set up plugin CI:
  - [ ] TypeScript build
  - [ ] Linting (ESLint)
  - [ ] Unit tests
  - [ ] Integration tests
- [ ] Set up Flutter app CI:
  - [ ] Flutter build
  - [ ] Flutter analyze
  - [ ] Flutter test
- [ ] Set up release automation (optional)
  - [ ] npm publish for plugin
  - [ ] GitHub releases

### Git Configuration
- [ ] Set up branch protection (main)
- [ ] Configure commit message format (conventional commits)
- [ ] Add pre-commit hooks (lint-staged + husky)
  - [ ] Run ESLint on TypeScript files
  - [ ] Run Flutter analyze on Dart files
  - [ ] Run Prettier

## Workspace Configuration

### pnpm-workspace.yaml
```yaml
packages:
  - 'packages/*'
```

### Root package.json
```json
{
  "name": "fletcher",
  "version": "1.0.0",
  "private": true,
  "description": "Voice-first bridge for OpenClaw using LiveKit",
  "repository": "dremonkey/openclaw-plugin-livekit",
  "license": "MIT",
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "lint": "pnpm -r lint",
    "format": "prettier --write '**/*.{ts,tsx,js,json,md}'",
    "plugin:dev": "pnpm --filter @openclaw/channel-livekit dev",
    "app:dev": "pnpm --filter fletcher-app run"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0",
    "prettier": "^3.0.0",
    "eslint": "^8.0.0",
    "husky": "^8.0.0",
    "lint-staged": "^15.0.0"
  },
  "engines": {
    "node": ">=20.0.0",
    "pnpm": ">=8.0.0"
  }
}
```

### Plugin package.json
```json
{
  "name": "@openclaw/channel-livekit",
  "version": "1.0.0",
  "description": "LiveKit voice channel for OpenClaw",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "openclaw": {
    "extensions": ["dist/index.js"],
    "channel": {
      "id": "livekit",
      "label": "LiveKit Voice",
      "blurb": "Real-time voice conversations with <1.5s latency"
    }
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "bun test",
    "lint": "eslint src --ext .ts"
  },
  "dependencies": {
    "livekit-server-sdk": "^2.0.0",
    "@deepgram/sdk": "^3.0.0",
    "@cartesia/cartesia-js": "^1.0.0",
    "@sinclair/typebox": "^0.32.0"
  },
  "devDependencies": {
    "openclaw": "workspace:*"
  },
  "peerDependencies": {
    "openclaw": ">=2.0.0"
  }
}
```

## Development Workflow

### Local Development
```bash
# Install all dependencies
pnpm install

# Build plugin
pnpm plugin:dev

# Run Flutter app (separate terminal)
pnpm app:dev

# Run tests
pnpm test

# Lint everything
pnpm lint
```

### Testing Plugin with OpenClaw
```bash
# Link plugin to local OpenClaw installation
cd path/to/openclaw
pnpm link ../fletcher/packages/openclaw-channel-livekit

# Or install from npm (after publishing)
pnpm add @openclaw/channel-livekit
```

## Success Criteria
- ✅ Monorepo structure created with proper workspace configuration
- ✅ Plugin package follows OpenClaw plugin conventions
- ✅ Flutter app properly structured
- ✅ CI/CD pipelines run on push/PR
- ✅ Linting and formatting enforced
- ✅ Documentation complete and clear
- ✅ Examples provided for easy setup

## Notes
- Use Bun as runtime for TypeScript (faster than Node)
- Plugin should be published to npm as `@openclaw/channel-livekit`
- Flutter app is for end users, not published to npm
- Keep plugin dependencies minimal (bundle size matters)
- Document system requirements (Bun version, Flutter version, etc.)
