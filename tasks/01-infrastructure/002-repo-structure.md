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
│   │   ├── package.json              # @openclaw/channel-livekit - MANAGED BY BUN
│   │   ├── tsconfig.json
│   │   ├── node_modules/             # Bun workspace (isolated mode)
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
│   └── fletcher-app/                 # Flutter mobile app - INDEPENDENT
│       ├── pubspec.yaml              # Dart/Flutter packages - MANAGED BY PUB
│       ├── .dart_tool/               # Flutter tooling (NOT Bun)
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
├── package.json                      # Workspace root (with workspaces field)
├── bun.lockb                         # Bun lockfile
├── tsconfig.base.json                # Shared TypeScript config
├── .gitignore                        # Both JS and Flutter ignores
├── LICENSE
└── README.md
```

## Package Manager: Bun

Using Bun's built-in package manager for monorepo:
- Native workspace support (same format as npm/pnpm/yarn)
- 4-8x faster installs than pnpm
- Unified runtime and package manager
- Simpler toolchain (one tool instead of two)
- **Strict mode enabled** - Isolated installs prevent phantom dependencies

## Implementation Checklist

### Monorepo Setup
- [ ] Initialize git repository
- [ ] Create monorepo structure with packages/ directory
- [ ] Set up Bun workspace with isolated mode (plugin only)
- [ ] Create root package.json with workspace and strict mode configuration
- [ ] Create .gitignore:
  - [ ] JavaScript: node_modules/, dist/, .env, bun.lockb
  - [ ] Flutter: .dart_tool/, build/, *.g.dart, .flutter-plugins*
- [ ] Run `bun install` to initialize plugin workspace (will use isolated installs)
- [ ] Verify strict mode with `bun pm ls` (should show isolated structure)

### OpenClaw Plugin Package
- [ ] Create packages/openclaw-channel-livekit/
- [ ] Initialize package.json with openclaw.extensions
- [ ] Set up TypeScript configuration
- [ ] Create src/ directory structure
- [ ] Add dependencies with `bun add livekit-server-sdk @deepgram/sdk @cartesia/cartesia-js`
- [ ] Set up ESLint + Prettier for TypeScript
- [ ] Create README.md with installation guide

### Flutter App Package (Independent - Not in Bun Workspace)
- [ ] Create packages/fletcher-app/
- [ ] Initialize Flutter project: `flutter create flutter-app` then move to packages/
- [ ] Add livekit_client dependency to pubspec.yaml
- [ ] Set up directory structure (screens, services, widgets)
- [ ] Configure Flutter linting (analysis_options.yaml)
- [ ] Create README.md with setup instructions
- [ ] **Note**: Does NOT use package.json, NOT managed by Bun, uses pub instead

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

### Examples & Configuration Files
- [ ] Create examples/ directory
- [ ] Add example openclaw.json configuration
- [ ] Add docker-compose.yml for LiveKit server
- [ ] Add example .env file (with placeholders)
- [ ] Create .gitignore with both JS and Flutter patterns:
```gitignore
# JavaScript / TypeScript (Bun/Node)
node_modules/
dist/
*.log
.env
.env.local
bun.lockb

# Flutter / Dart
.dart_tool/
.flutter-plugins
.flutter-plugins-dependencies
.packages
build/
*.g.dart
*.freezed.dart
pubspec.lock

# IDEs
.vscode/
.idea/
*.swp
*.swo
*~

# OS
.DS_Store
Thumbs.db
```

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

## Flutter App Independence

**Important**: The Flutter app (Dart) is **NOT part of the Bun workspace**.

### Why?
- Flutter uses `pubspec.yaml` + `pub` package manager (Dart ecosystem)
- Bun workspaces only manage JavaScript/TypeScript packages (package.json)
- These are two separate ecosystems that don't interact

### Structure
```
packages/
├── openclaw-channel-livekit/   # JavaScript - Managed by Bun
│   ├── package.json
│   └── node_modules/
│
└── fletcher-app/               # Dart - Managed by Flutter pub
    ├── pubspec.yaml
    └── .dart_tool/
```

### Implications
- **Workspaces config**: Only includes `packages/openclaw-channel-livekit`
- **Bun strict mode**: Only affects the plugin package, not Flutter app
- **Dependencies**: Install separately for each
  ```bash
  # Plugin dependencies
  bun install

  # Flutter app dependencies (in separate terminal)
  cd packages/fletcher-app && flutter pub get
  ```

## Strict Dependency Isolation (Plugin Only)

The OpenClaw plugin uses **Bun isolated mode** (like pnpm) for strict dependency management:

### What This Means
- ✅ **Prevents phantom dependencies** - Can only import packages declared in package.json
- ✅ **Catches missing dependencies early** - Fails immediately, not in production
- ✅ **Better for publishing** - Plugin works reliably for users
- ✅ **Reproducible builds** - Same dependencies every time

### How It Works
```bash
# Isolated mode uses symlinks (like pnpm)
node_modules/
├── .bin/
├── express -> .bun/install/cache/...     # Only declared deps get symlinks
└── your-package/
```

Instead of hoisting everything to root, only explicitly declared dependencies are accessible.

### Handling "Cannot Find Module" Errors

If you see errors like:
```
Error: Cannot find module 'body-parser'
```

**Solution**: Add the missing dependency to package.json:
```bash
bun add --cwd packages/openclaw-channel-livekit body-parser
```

This is actually **good** - it forces you to declare all dependencies correctly!

## Workspace Configuration

### Root package.json

Bun uses the standard `workspaces` field with strict mode enabled:
```json
{
  "name": "fletcher",
  "version": "1.0.0",
  "private": true,
  "description": "Voice-first bridge for OpenClaw using LiveKit",
  "repository": "dremonkey/openclaw-plugin-livekit",
  "license": "MIT",
  "workspaces": ["packages/openclaw-channel-livekit"],
  "bun": {
    "install": {
      "linker": "isolated"
    }
  },
  "scripts": {
    "build": "bun run --filter '*' build",
    "test": "bun run --filter '*' test",
    "lint": "bun run --filter '*' lint",
    "format": "prettier --write '**/*.{ts,tsx,js,json,md}'",
    "plugin:dev": "bun --cwd packages/openclaw-channel-livekit run dev",
    "plugin:build": "bun --cwd packages/openclaw-channel-livekit run build",
    "app:dev": "cd packages/fletcher-app && flutter run"
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
    "bun": ">=1.0.0"
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
# Install all dependencies (root and all workspaces)
bun install

# Build plugin
bun run plugin:dev

# Build plugin (one-time)
bun run plugin:build

# Run Flutter app (separate terminal)
bun run app:dev
# Or directly: cd packages/fletcher-app && flutter run

# Run tests
bun test

# Lint everything
bun run lint
```

### Testing Plugin with OpenClaw
```bash
# Link plugin to local OpenClaw installation
cd path/to/openclaw
bun link ../fletcher/packages/openclaw-channel-livekit

# Or install from npm (after publishing)
bun add @openclaw/channel-livekit
```

### Bun Workspace Commands
```bash
# Install dependency in specific package
bun add --cwd packages/openclaw-channel-livekit some-package

# Run script in specific package
bun --cwd packages/openclaw-channel-livekit run build

# Run script in all packages
bun run --filter '*' build
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

### General
- Use Bun as runtime and package manager (unified toolchain) **for plugin only**
- Bun workspaces are compatible with npm/pnpm/yarn workspace format
- Plugin should be published to npm as `@openclaw/channel-livekit`
- Flutter app is for end users, not published to npm
- Keep plugin dependencies minimal (bundle size matters)
- Document system requirements (Bun >= 1.0.0, Flutter >= 3.x, etc.)
- Bun's workspace support uses `--cwd` flag instead of pnpm's `--filter`

### Flutter App (Dart/Flutter Ecosystem)
- **NOT part of Bun workspace** - Uses Flutter's pub package manager
- Uses `pubspec.yaml` instead of `package.json`
- Managed independently with `flutter pub get`
- Has its own `.dart_tool/` and build artifacts
- Bun strict mode does NOT apply to Flutter app
- Both packages can coexist in same monorepo without interaction

### Strict Mode (Isolated Installs)
- **Enabled by default** via `bun.install.linker: "isolated"` in root package.json
- Prevents phantom dependencies (can only import declared packages)
- Uses symlink-based isolation like pnpm
- If you get "Cannot find module" errors, add the package to dependencies
- This is a **feature, not a bug** - ensures clean dependency graph
- Makes plugin more reliable when published to npm
- Lockfile will have `configVersion: 1` (indicates isolated mode)

### Debugging Dependency Issues
```bash
# List all installed packages
bun pm ls

# Check what packages are accessible in a workspace
bun --cwd packages/openclaw-channel-livekit pm ls

# View dependency tree
bun pm ls --all
```
