# Task 009: Persistent History Discovery

## Requirement
Fletcher should fetch recent message history from OpenClaw on rejoin to repopulate the transcript. Currently, the transcript is lost when the app is closed or reconnected.

## Features
- **Fetch History on Rejoin**: When the Flutter app connects to a room and identifies its session, it should request the recent message history from OpenClaw.
- **Session List UI**: Add a 'Session List' view in the app to allow the user to discover and resume existing OpenClaw sessions.
- **Transcript Repopulation**: Inject the fetched history into the local transcript state so the user sees their previous conversation context.

## Implementation Details
- Update `@knittt/livekit-agent-ganglia` to support history retrieval if not already present.
- Implement history fetching logic in the Flutter app's connection flow.
- Create a new UI component/screen for session discovery.
