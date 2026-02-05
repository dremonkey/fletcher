# Fletcher Mobile App

A minimal, voice-first conversational interface for OpenClaw. Features a single amber orb that responds to voice - no clutter, pure conversation.

## Prerequisites

### 1. Flutter SDK

Install Flutter following the official guide: https://docs.flutter.dev/get-started/install

Verify installation:
```bash
flutter doctor
```

### 2. Android Studio (for Android development)

1. **Download Android Studio**: https://developer.android.com/studio

2. **Install Android SDK** (via Android Studio):
   - Open Android Studio → Settings → Languages & Frameworks → Android SDK
   - Install Android SDK (API 34 recommended)
   - Install Android SDK Command-line Tools
   - Install Android SDK Build-Tools

3. **Create an Android Emulator**:
   - Open Android Studio → Tools → Device Manager
   - Click "Create Device"
   - Select a phone (e.g., Pixel 7)
   - Download a system image (API 34 recommended)
   - Finish setup

4. **Set environment variables** (add to `~/.bashrc` or `~/.zshrc`):
   ```bash
   export ANDROID_HOME=$HOME/Android/Sdk
   export PATH=$PATH:$ANDROID_HOME/emulator
   export PATH=$PATH:$ANDROID_HOME/platform-tools
   ```

5. **Verify setup**:
   ```bash
   flutter doctor --android-licenses  # Accept licenses
   flutter doctor                      # Should show Android toolchain ✓
   ```

### 3. Xcode (for iOS development, macOS only)

1. Install Xcode from the App Store
2. Run: `sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer`
3. Run: `sudo xcodebuild -runFirstLaunch`

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

3. **Configure the app** - Edit `lib/main.dart`:
   ```dart
   const String livekitUrl = 'wss://YOUR-PROJECT.livekit.cloud';  // From .env
   const String livekitToken = 'YOUR_TOKEN_HERE';                  // From step 2
   ```

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
- Verify your LiveKit URL and token are correct
- Check that the token hasn't expired (24h default)
- Generate a new token: `bun run token:generate`
