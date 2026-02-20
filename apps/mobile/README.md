# Fletcher Mobile App

A minimal, voice-first conversational interface for OpenClaw. Features a single amber orb that responds to voice - no clutter, pure conversation.

## Prerequisites

### Option A: Nix (Recommended)

The repo includes a `flake.nix` that provides Flutter, Bun, Android SDK, and JDK automatically. From the repo root:

```bash
# direnv will activate automatically if you have it, otherwise:
nix develop
```

This handles everything except Xcode and CocoaPods (macOS-only, see below).

### Option B: Manual Install

#### 1. Flutter SDK

Install Flutter following the official guide: https://docs.flutter.dev/get-started/install

Verify installation:
```bash
flutter doctor
```

#### 2. Android Studio (for Android development, Linux only)

On **NixOS**, Android Studio and the SDK are provided by the Nix flake. On **macOS**, use Xcode + iOS Simulator instead (Android Studio is not available via Nix on macOS).

For manual (non-Nix) setups:

1. **Download Android Studio**: https://developer.android.com/studio
2. **Install Android SDK** (via Android Studio → Settings → Languages & Frameworks → Android SDK)
3. **Create an Android Emulator** (via Android Studio → Tools → Device Manager)
4. **Set environment variables** (add to `~/.zshrc`):
   ```bash
   export ANDROID_HOME=$HOME/Android/Sdk
   export PATH=$PATH:$ANDROID_HOME/emulator
   export PATH=$PATH:$ANDROID_HOME/platform-tools
   ```
5. **Accept licenses**:
   ```bash
   flutter doctor --android-licenses
   ```

### macOS: Xcode + CocoaPods (required for iOS)

1. **Install Xcode** from the App Store:
   ```bash
   open "macappstore://apps.apple.com/app/xcode/id497799835"
   ```
2. **Configure Xcode command-line tools**:
   ```bash
   sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer
   sudo xcodebuild -runFirstLaunch
   ```
3. **Install CocoaPods**:
   ```bash
   brew install cocoapods
   ```
4. **Verify**:
   ```bash
   flutter doctor  # Should show Xcode ✓ and CocoaPods ✓
   ```

## Setup

1. **Install dependencies**:
   ```bash
   cd apps/mobile
   flutter pub get
   ```

2. **Generate a LiveKit token** (from repo root):
   ```bash
   bun run token:generate
   ```
   This automatically updates `apps/mobile/.env` with the URL and token.

> **Note:** The app loads credentials from `.env` at runtime using `flutter_dotenv`. Tokens expire after 24 hours, so run `bun run token:generate` to refresh. In production, the app will fetch tokens from the backend API instead.

## Running the App

### Android Emulator
```bash
# List available emulators
emulator -list-avds

# Start an emulator
emulator -avd <avd_name>

# Run the app
flutter run
```

### Physical Android Device
1. Enable Developer Options on your phone
2. Enable USB Debugging
3. Connect via USB
4. Run: `flutter run`

### iOS Simulator (macOS only)
```bash
open -a Simulator
flutter run
```

## Architecture

```
lib/
├── main.dart                    # App entry, dark theme, auto-connect
├── models/
│   └── conversation_state.dart  # ConversationStatus enum, state model
├── screens/
│   └── conversation_screen.dart # Main (only) screen
├── services/
│   └── livekit_service.dart     # LiveKit connection & audio level monitoring
└── widgets/
    ├── amber_orb.dart           # Animated orb with all conversation states
    └── mute_toggle.dart         # Microphone mute button
```

## App States

| State | Orb Behavior |
|-------|--------------|
| Connecting | Soft pulse, dimmed |
| Idle/Listening | Gentle breathing glow |
| User Speaking | Ripples outward |
| Processing | Subtle shimmer |
| AI Speaking | Pulses with voice |
| Muted | Dim, static |
| Error | Red tint |

## Troubleshooting

**"flutter: command not found"**
- Add Flutter to your PATH: `export PATH=$PATH:/path/to/flutter/bin`

**"No connected devices"**
- Start an emulator or connect a physical device
- Run `flutter devices` to list available devices

**Microphone permission denied**
- On Android: Check app permissions in Settings
- On iOS: The permission dialog should appear on first launch

**LiveKit connection failed**
- Generate a fresh token: `bun run token:generate`
- Check that `.env` contains valid `LIVEKIT_URL` and `LIVEKIT_TOKEN`
- Tokens expire after 24 hours
