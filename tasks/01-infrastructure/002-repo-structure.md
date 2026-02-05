---
status: completed
completed_at: 2026-02-04
---

# Task: Repository Structure & CI/CD

## Description
Set up the monorepo structure for the OpenClaw channel plugin and Flutter app, following OpenClaw plugin conventions.

## Architecture Decision
Fletcher will be built as an **OpenClaw Channel Plugin** (`@openclaw/channel-livekit`), not a standalone service. This provides:
- Deep integration with OpenClaw
- Automatic conversation management
- Single deployment
- Access to all OpenClaw features

## Monorepo Structure (Following Industry Best Practices)

This structure follows the **package-centric + app-centric hybrid** pattern, which is the industry standard for monorepos containing both libraries and applications.

### Why This Structure?

**`packages/`** - Reusable libraries (published to registries)
- Contains code that will be **published** (npm, pub.dev, etc.)
- Used by: Nx, Turborepo, pnpm workspaces, Lerna, Yarn workspaces
- Example: `@openclaw/channel-livekit` - published to npm

**`apps/`** - Deployable applications (end-user products)
- Contains **buildable and deployable** applications
- NOT published to package registries
- Example: `mobile` - Flutter app distributed via app stores

**Not Recommended**:
- ❌ Organizing by language (`typescript/`, `dart/`) - Provides no functional meaning
- ❌ Flat structure (`plugin/`, `app/` at root) - Doesn't scale, unclear purpose
- ❌ Everything in `packages/` - Confuses libraries with applications

### References
- [Nx Monorepo Structure](https://nx.dev/blog/setup-a-monorepo-with-pnpm-workspaces-and-speed-it-up-with-nx)
- [Monorepo Tools Guide](https://monorepo.tools/)
- [Multi-language Monorepo Management](https://graphite.com/guides/managing-multiple-languages-in-a-monorepo)

```
fletcher/
├── packages/                         # Reusable libraries (published to npm)
│   └── openclaw-channel-livekit/     # OpenClaw channel plugin
│       ├── package.json              # @openclaw/channel-livekit - MANAGED BY BUN
│       ├── tsconfig.json
│       ├── node_modules/             # Bun workspace (isolated mode)
│       ├── src/
│       │   ├── index.ts              # Plugin entry point
│       │   ├── channel.ts            # Channel implementation
│       │   ├── config.ts             # Configuration schema
│       │   ├── livekit/
│       │   │   ├── connection.ts     # LiveKit room management
│       │   │   ├── participant.ts    # Participant handling
│       │   │   └── audio.ts          # Audio track management
│       │   ├── pipeline/
│       │   │   ├── stt.ts            # Speech-to-text
│       │   │   ├── tts.ts            # Text-to-speech
│       │   │   └── buffer.ts         # Audio buffering
│       │   └── types.ts              # TypeScript types
│       ├── skills/                   # Optional OpenClaw skills
│       │   └── voice-call/
│       │       └── SKILL.md
│       ├── tests/
│       │   ├── unit/
│       │   └── integration/
│       └── README.md
│
├── apps/                             # Deployable applications
│   └── mobile/                       # Flutter mobile app
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
- [x] Initialize git repository
- [x] Create monorepo structure: `packages/` and `apps/` directories
- [x] Set up Bun workspace with isolated mode (for packages/ only)
- [x] Create root package.json with workspace and strict mode configuration
- [x] Create .gitignore:
  - [x] JavaScript: node_modules/, dist/, .env, bun.lockb
  - [x] Flutter: .dart_tool/, build/, *.g.dart, .flutter-plugins*
- [x] Run `bun install` to initialize workspace (will use isolated installs)
- [x] Verify strict mode with `bun pm ls` (should show isolated structure)

### OpenClaw Plugin Package
- [x] Create packages/openclaw-channel-livekit/ directory
- [x] Initialize package.json with openclaw.extensions field
- [x] Set up TypeScript configuration (tsconfig.json)
- [x] Create src/ directory structure
- [x] Add dependencies: `bun add livekit-server-sdk @deepgram/sdk @cartesia/cartesia-js @sinclair/typebox`
- [x] Set up ESLint + Prettier for TypeScript
- [x] Create README.md with installation guide
- [x] **Note**: This is a library/package that will be published to npm

### Flutter Mobile Application (Independent - Not in Bun Workspace)
- [x] Create apps/mobile/ directory
- [x] Initialize Flutter project: `flutter create --org com.fletcher --project-name fletcher apps/mobile`
- [x] Add livekit_client dependency to pubspec.yaml
- [x] Set up directory structure (screens, services, widgets)
- [x] Configure Flutter linting (analysis_options.yaml)
- [x] Create README.md with setup instructions
- [x] **Note**: This is an application (not a library) - uses pub, not Bun

### Shared Configuration
- [x] Create tsconfig.base.json for shared TS settings
- [x] Set up shared ESLint config
- [x] Set up shared Prettier config
- [x] Create .editorconfig for consistent formatting

### Documentation
- [x] Move docs/ to root level
- [x] Create setup-guide.md with full instructions
- [x] Document plugin installation process
- [x] Document Flutter app setup
- [x] Add contribution guidelines

### Examples & Configuration Files
- [x] Create examples/ directory
- [x] Add example openclaw.json configuration
- [x] Add docker-compose.yml for LiveKit server
- [x] Add example .env file (with placeholders)
- [x] Create .gitignore with both JS and Flutter patterns:
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
- [x] Create .github/workflows/ directory
- [x] Set up plugin CI:
  - [x] TypeScript build
  - [x] Linting (ESLint)
  - [x] Unit tests
  - [x] Integration tests
- [x] Set up Flutter app CI:
  - [x] Flutter build
  - [x] Flutter analyze
  - [x] Flutter test
- [x] Set up release automation (optional)
  - [x] npm publish for plugin
  - [x] GitHub releases

### Git Configuration
- [x] Set up branch protection (main)
- [x] Configure commit message format (conventional commits)
- [x] Add pre-commit hooks (lint-staged + husky)
  - [x] Run ESLint on TypeScript files
  - [x] Run Flutter analyze on Dart files
  - [x] Run Prettier

## Flutter App Independence

**Important**: The Flutter app (Dart) is **NOT part of the Bun workspace**.

### Why?
- Flutter uses `pubspec.yaml` + `pub` package manager (Dart ecosystem)
- Bun workspaces only manage JavaScript/TypeScript packages (package.json)
- These are two separate ecosystems that don't interact

### Structure
```
fletcher/
├── packages/                           # Reusable libraries
│   └── openclaw-channel-livekit/       # Plugin - Managed by Bun
│       ├── package.json
│       └── node_modules/
│
└── apps/                               # Deployable applications
    └── mobile/                         # Flutter app - Managed by pub
        ├── pubspec.yaml
        └── .dart_tool/
```

### Implications
- **Workspaces config**: Only includes `packages/*` (just the plugin)
- **Bun strict mode**: Only affects packages in `packages/`, not apps in `apps/`
- **Dependencies**: Install separately for each ecosystem
  ```bash
  # Plugin dependencies (JavaScript/TypeScript)
  bun install

  # Mobile app dependencies (Dart/Flutter) - in separate terminal
  cd apps/mobile && flutter pub get
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
  "workspaces": ["packages/*"],
  "bun": {
    "install": {
      "linker": "isolated"
    }
  },
  "scripts": {
    "build": "bun --cwd packages/openclaw-channel-livekit run build",
    "test": "bun --cwd packages/openclaw-channel-livekit run test",
    "lint": "bun --cwd packages/openclaw-channel-livekit run lint",
    "format": "prettier --write '**/*.{ts,tsx,js,json,md}'",
    "plugin:dev": "bun --cwd packages/openclaw-channel-livekit run dev",
    "plugin:build": "bun --cwd packages/openclaw-channel-livekit run build",
    "mobile:dev": "cd apps/mobile && flutter run",
    "mobile:build:android": "cd apps/mobile && flutter build apk",
    "mobile:build:ios": "cd apps/mobile && flutter build ios"
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
# Install all dependencies (root and all packages/*)
bun install

# Develop plugin (watch mode)
bun run plugin:dev

# Build plugin (one-time)
bun run plugin:build

# Run Flutter app (separate terminal)
bun run mobile:dev
# Or directly: cd apps/mobile && flutter run

# Run plugin tests
bun run test

# Lint plugin code
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
# Install dependency in plugin package
bun add --cwd packages/openclaw-channel-livekit some-package

# Run script in plugin package
bun --cwd packages/openclaw-channel-livekit run build

# List all workspace packages
bun pm ls
```

## Multi-Language Monorepo Considerations

### Language Separation
- **JavaScript/TypeScript** (packages/*): Managed by Bun, builds with `tsc`
- **Dart/Flutter** (apps/*): Managed by Flutter pub, builds with `flutter build`
- **No shared dependencies** between languages - completely independent

### Build Orchestration
Each language uses its own build tool:
```bash
# Plugin build (TypeScript → JavaScript)
bun --cwd packages/openclaw-channel-livekit run build

# Mobile build (Dart → APK/IPA)
cd apps/mobile && flutter build apk
```

### CI/CD Strategy
- Separate workflows for packages and apps
- Use path filters to only run relevant builds:
  ```yaml
  # .github/workflows/plugin-ci.yml
  on:
    push:
      paths:
        - 'packages/**'

  # .github/workflows/mobile-ci.yml
  on:
    push:
      paths:
        - 'apps/mobile/**'
  ```

### Versioning Strategy
- **Plugin**: Semantic versioning (npm standard)
- **Mobile app**: Platform-specific versioning (versionCode/CFBundleVersion)
- **Independent releases**: Each can be released separately

## Success Criteria
- ✅ Monorepo structure follows industry best practices (`packages/` + `apps/`)
- ✅ Plugin package follows OpenClaw plugin conventions
- ✅ Flutter app properly structured in `apps/`
- ✅ Bun workspace only includes JavaScript/TypeScript packages
- ✅ CI/CD pipelines use path filters for efficient builds
- ✅ Linting and formatting enforced per-language
- ✅ Documentation complete and clear
- ✅ Examples provided for easy setup
- ✅ Multi-language setup allows independent development and releases

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

# Check what packages are accessible in plugin
bun --cwd packages/openclaw-channel-livekit pm ls

# View full dependency tree
bun pm ls --all

# Check if isolated mode is active (look for configVersion: 1)
cat bun.lockb | head -20
```
