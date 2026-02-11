# Task: Flutter Project Initialization ✅

## Description
Create the Flutter project and add the `livekit_client` dependency.

## Checklist
- [x] Create new Flutter app in `apps/mobile/`.
- [x] Add `livekit_client` to `pubspec.yaml` (v2.5.0).
- [x] Add `permission_handler` for permissions.
- [x] Add `flutter_dotenv` for environment config.
- [x] Set up permissions for Microphone (iOS/Android).
- [x] Implement basic UI with auto-connect on launch.
- [x] LiveKitService for connection management.
- [x] ConversationScreen as main (only) screen.
- [x] MuteToggle widget for microphone control.

## Implementation
- `lib/main.dart` - App entry, dark theme, auto-connect
- `lib/services/livekit_service.dart` - LiveKit connection & audio monitoring
- `lib/screens/conversation_screen.dart` - Main screen
- `lib/models/conversation_state.dart` - State model
- `lib/widgets/mute_toggle.dart` - Mic mute button
