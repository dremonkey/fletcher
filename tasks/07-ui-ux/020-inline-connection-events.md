# TASK-020: Inline Connection & Room Events

## Status
- **Status:** Complete
- **Priority:** Medium
- **Depends on:** 017 (Chat-First Main View)
- **Owner:** TBD
- **Created:** 2026-03-07

## Context
The chat transcript should show connection lifecycle events inline — like a terminal session log. On app launch, the user sees the boot sequence unfold in real time: network resolution, room connection, agent arrival. When network conditions change later (e.g., leaving Wi-Fi, switching to Tailscale), new event cards appear inline showing the transition.

This gives users visibility into what's happening behind the scenes without needing to open the diagnostics modal. It also creates a natural "session history" that captures not just conversation turns but infrastructure events.

## Reference
- **Design philosophy:** See [EPIC.md — Design Philosophy](./EPIC.md#design-philosophy)
- **Existing diagnostics:** Task 019 (status bar + modal) shows point-in-time metrics. This task shows the _timeline_ of events.

## Design

### Event Card Style
System event cards are visually distinct from conversation messages:
- **No TuiHeader** (no `┌─ LABEL ─┐`) — these are not conversation turns
- **Compact single-line or two-line cards** — minimal vertical footprint
- **Left border:** cyan (system color), not amber
- **Icon prefix:** monospace symbol (e.g., `▸`, `●`, `⚡`, `✕`) before the status text
- **Text:** 12sp monospace in `AppColors.cyan` for labels, `AppColors.textPrimary` for values
- **Background:** `AppColors.surface` with cyan left border
- **Timestamp:** right-aligned in `AppTypography.overline`
- **No touch interaction** — these are informational, not tappable

### Live Status Updates
Each event card shows a status that updates in place (not appending new cards):
- `RESOLVING...` → `CONNECTED` (or `ERROR: ...`)
- Use `AnimatedSwitcher` or similar for smooth text transitions
- Status text color: `textSecondary` while pending, `healthGreen` on success, `healthRed` on error

### Boot Sequence (app launch)
On startup, three event cards appear sequentially in the chat stream:

```
▸ NETWORK    resolving...                              12:00:01
```
↓ resolves to:
```
▸ NETWORK    tailscale 100.x.x.x                      12:00:01
```

Then:
```
▸ ROOM       connecting...                             12:00:02
```
↓ resolves to:
```
▸ ROOM       fletcher-1234567 · joined                 12:00:02
```

Then:
```
▸ AGENT      waiting...                                12:00:02
```
↓ resolves to:
```
▸ AGENT      connected · ready                         12:00:03
```

### Runtime Events (mid-session)
When conditions change, new event cards are inserted at the current scroll position:

**Network switch:**
```
⚡ NETWORK   switching...                              12:15:44
```
↓
```
⚡ NETWORK   lan 192.168.1.x                           12:15:45
```

**Reconnection:**
```
✕ ROOM       disconnected · reconnecting...            12:15:44
```
↓
```
▸ ROOM       fletcher-1234567 · reconnected            12:15:48
```

**Agent departure/arrival:**
```
✕ AGENT      disconnected                              12:20:01
▸ AGENT      connected · ready                         12:20:03
```

**Room recovery (new room after timeout):**
```
✕ ROOM       departed · creating new room...           12:25:00
▸ ROOM       fletcher-9876543 · joined                 12:25:02
▸ AGENT      connected · ready                         12:25:03
```

### Event Data Sources
Map existing `LiveKitService` events/state to inline cards:

| Event Source | Card Type | Trigger |
|---|---|---|
| `UrlResolver` result | NETWORK | `connectWithDynamicRoom` — after URL race resolves |
| `Room.connect()` | ROOM | Room joined / room name available |
| `ParticipantConnectedEvent` | AGENT | Remote participant joins |
| `ParticipantDisconnectedEvent` | AGENT | Remote participant leaves |
| `RoomReconnectingEvent` | ROOM | SDK reconnecting |
| `RoomReconnectedEvent` | ROOM | SDK reconnected |
| `RoomDisconnectedEvent` | ROOM | Disconnected (with reason) |
| `ConnectivityService` change | NETWORK | Online/offline transition |
| New room creation (budget expired) | ROOM | Reconnect budget exhausted, new room |

## Implementation

### New Model: `SystemEvent`
Add to `lib/models/conversation_state.dart` (or a new `system_event.dart`):

```dart
enum SystemEventType { network, room, agent }
enum SystemEventStatus { pending, success, error }

class SystemEvent {
  final String id;
  final SystemEventType type;
  final SystemEventStatus status;
  final String message;       // e.g., "tailscale 100.x.x.x"
  final DateTime timestamp;
  final String prefix;        // e.g., "▸", "⚡", "✕"
}
```

### State Integration
Add `List<SystemEvent>` to `ConversationState`. `LiveKitService` emits system events at each lifecycle point. Events with the same `id` are updated in place (status change), not duplicated.

### Chat Transcript Integration
`ChatTranscript` interleaves `SystemEvent` cards with `TranscriptEntry` messages, ordered by timestamp. A unified item model:

```dart
// Extend _ChatItem to support system events
_ChatItem.systemEvent(SystemEvent event)
```

### New Widget: `SystemEventCard`
`lib/widgets/system_event_card.dart` — renders a single compact event card.

## Acceptance Criteria
- [x] Boot sequence shows NETWORK → ROOM → AGENT cards sequentially on launch
- [x] Each card status updates in place (pending → success/error)
- [x] Network card shows transport type and IP (tailscale/lan/emulator)
- [x] Room card shows room name on successful join
- [x] Agent card shows connected/disconnected state
- [x] Mid-session network changes insert new NETWORK card inline
- [x] Reconnection events show ROOM status changes inline
- [x] Agent departure/arrival shows AGENT cards inline
- [x] Event cards use cyan left border, 12sp monospace, compact layout
- [x] Cards are visually distinct from conversation messages (no TuiHeader)
- [x] Pending status in textSecondary, success in healthGreen, error in healthRed
- [x] All events include timestamp
- [x] Cards are not tappable (informational only)
- [x] Existing chat scroll behavior (auto-scroll, manual override) still works
- [x] Unit tests for SystemEvent model and SystemEventCard widget
