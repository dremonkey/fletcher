# LiveKit Room Metadata Schema (Voice/Chat Coordination)

**Status:** ✅ Ready for Implementation  
**Date:** 2026-03-10  
**Purpose:** Define room metadata schema for coordinating Voice Mode (livekit-agent) and Chat Mode (relay participant) handoffs.

---

## Problem Statement

Fletcher supports two interaction modes:
1. **Voice Mode:** Mobile ↔ LiveKit ↔ `livekit-agent` (Ganglia) → STT/TTS/VAD + LLM
2. **Chat Mode:** Mobile ↔ LiveKit ↔ Relay (non-agent participant) → LLM only

**Coordination Challenge:**
- Both the voice agent and the relay can join the same LiveKit room
- Only ONE should be handling LLM requests at a time
- Need a signaling mechanism to avoid double-processing messages
- Need clear handoff protocol when switching modes (voice → chat, chat → voice)

**Solution:**
- Use **LiveKit room metadata** to signal which mode is active
- Participants (agent, relay, mobile) read metadata before responding
- Metadata acts as a "lock" — only the designated participant handles LLM requests

---

## Metadata Schema

### Metadata Key

**Key:** `mode`

**Storage:** LiveKit room metadata (JSON object, server-managed)

**Scope:** Per-room (all participants see the same metadata)

**Access:**
- **Read:** All participants (mobile, agent, relay)
- **Write:** Agent and relay only (mobile is read-only)

### Metadata Values

| Value | Meaning | Active Participant | Lifecycle |
|-------|---------|-------------------|-----------|
| `"voice"` | Voice mode active | `livekit-agent` (Ganglia) | Set by agent on connect, cleared on agent disconnect |
| `"chat"` | Chat mode active | Relay participant | Set by relay on first message, cleared on relay disconnect |
| `"idle"` | No mode active | None | Default when room is created, or when both agent and relay leave |
| `null` | (Same as `"idle"`) | None | Room metadata not set yet |

**Example Metadata JSON:**
```json
{
  "mode": "voice"
}
```

**Full Room Metadata Object (LiveKit API):**
```json
{
  "name": "room-abc123",
  "sid": "RM_xyz",
  "metadata": "{\"mode\":\"voice\"}",  // JSON string (LiveKit serializes objects as strings)
  "numParticipants": 2,
  "creationTime": 1710123456
}
```

---

## State Machine

```
┌────────────────────────────────────────────────┐
│                 Room Created                    │
│                  mode = "idle"                  │
└────────────────┬───────────────────────────────┘
                 │
        ┌────────┴─────────┐
        │                  │
        ▼                  ▼
┌──────────────┐   ┌──────────────┐
│ Agent Joins  │   │ Relay First  │
│ First Voice  │   │ Message Sent │
│ Request      │   │              │
│              │   │              │
│ mode="voice" │   │ mode="chat"  │
└──────┬───────┘   └──────┬───────┘
       │                  │
       │ User sends text  │ Agent joins
       │ message          │ (voice request)
       │                  │
       ▼                  ▼
┌──────────────┐   ┌──────────────┐
│ Voice→Chat   │   │ Chat→Voice   │
│ Handoff      │   │ Handoff      │
│              │   │              │
│ Agent sets   │   │ Relay clears │
│ mode="chat"  │   │ Agent sets   │
│ Agent warm-  │   │ mode="voice" │
│ down         │   │              │
└──────┬───────┘   └──────┬───────┘
       │                  │
       └────────┬─────────┘
                │
                ▼
        ┌───────────────┐
        │ Both Offline  │
        │ mode="idle"   │
        └───────────────┘
```

---

## Metadata Operations

### 1. Read Metadata

**Mobile (Flutter):**
```dart
final room = liveKitService.room;
final metadataStr = room.metadata;
final metadata = metadataStr != null ? jsonDecode(metadataStr) : {};
final currentMode = metadata['mode'] ?? 'idle';

if (currentMode == 'voice') {
  // Voice mode active — show voice UI
} else if (currentMode == 'chat') {
  // Chat mode active — show text input
} else {
  // Idle — show mode picker
}
```

**Relay (Bun):**
```typescript
import { Room } from '@livekit/rtc-node';

const metadataStr = room.metadata || '{}';
const metadata = JSON.parse(metadataStr);
const currentMode = metadata.mode || 'idle';

if (currentMode === 'voice') {
  // Voice mode active — relay should NOT handle LLM requests
  console.log('Voice agent is active, relay is passive');
} else {
  // Idle or chat mode — relay can handle requests
}
```

**Voice Agent (Python livekit-agent):**
```python
# livekit-agent SDK (Python)
metadata_str = room.metadata or '{}'
metadata = json.loads(metadata_str)
current_mode = metadata.get('mode', 'idle')

if current_mode == 'chat':
    # Chat mode active — agent should not process LLM requests
    # Agent can still handle STT/TTS if needed
    logger.info('Chat mode active, agent is passive')
```

### 2. Set Metadata

**Relay (Bun):**
```typescript
import { RoomServiceClient } from '@livekit/rtc-node';

const roomClient = new RoomServiceClient(
  process.env.LIVEKIT_URL,
  process.env.LIVEKIT_API_KEY,
  process.env.LIVEKIT_API_SECRET
);

// Set chat mode
await roomClient.updateRoomMetadata(roomName, JSON.stringify({
  mode: 'chat'
}));
```

**Voice Agent (Python):**
```python
from livekit import api

# Set voice mode
room_service = api.RoomServiceClient()
await room_service.update_room_metadata(
    room_name,
    json.dumps({'mode': 'voice'})
)
```

**Note:** Mobile app does NOT set metadata — it only reads and reacts to changes.

---

## Coordination Rules

### Rule 1: Voice Mode Active

**When:** `mode === "voice"`

**Agent Behavior:**
- ✅ Process voice input (STT)
- ✅ Send LLM requests to backend
- ✅ Synthesize TTS responses
- ✅ Publish `ganglia-events` data channel messages (status, artifacts, transcripts)

**Relay Behavior:**
- ❌ Do NOT process `session/new` or `session/message` requests
- ✅ Return JSON-RPC error: `{ code: -32003, message: "Voice mode active, chat unavailable" }`
- ✅ Remain in room (passive participant) for fast handoff

**Mobile Behavior:**
- ✅ Show voice UI (waveform, talk button)
- ❌ Hide text input
- ✅ Display agent transcripts from `ganglia-events`

---

### Rule 2: Chat Mode Active

**When:** `mode === "chat"`

**Relay Behavior:**
- ✅ Process `session/new` and `session/message` requests
- ✅ Send LLM requests to OpenClaw
- ✅ Publish `session/update` notifications on `relay` data channel

**Agent Behavior:**
- ❌ Do NOT send LLM requests (Ganglia is paused)
- ✅ Continue STT/TTS if needed (for hybrid mode, future feature)
- ✅ Warm down after idle timeout (Epic 20 / Task 006)
- ✅ Publish `agent_warm_down` event on `ganglia-events` data channel

**Mobile Behavior:**
- ✅ Show text input
- ✅ Display streaming text from `relay` data channel
- ❌ Hide voice waveform (or show dimmed/inactive state)

---

### Rule 3: Idle Mode

**When:** `mode === "idle"` or `mode === null`

**Agent Behavior:**
- ✅ Can join room and set `mode = "voice"` if voice request arrives
- ✅ Agent dispatch service activates agent when user speaks

**Relay Behavior:**
- ✅ Can join room (if token server signals)
- ✅ Set `mode = "chat"` on first `session/new` or `session/message` request

**Mobile Behavior:**
- ✅ Show mode picker (voice button + text input both visible)
- ✅ First interaction (talk or type) triggers mode selection

**Conflict Resolution:**
- If both agent and relay try to set metadata simultaneously → LiveKit resolves with last-write-wins
- Agent and relay MUST check metadata BEFORE every LLM request
- If metadata changed between check and request → abort and surface error

---

## Handoff Protocols

### Handoff 1: Voice → Chat

**Trigger:** User stops talking and starts typing in text input.

**Steps:**

1. **Mobile sends `session/new` request** on `relay` data channel
2. **Relay checks room metadata:**
   - If `mode === "voice"` → Relay sets `mode = "chat"`
3. **Agent receives metadata update event:**
   - Agent stops processing new voice input
   - Agent sends `agent_warm_down` event on `ganglia-events` data channel
   - Agent enters idle state (ready to disconnect after timeout)
4. **Relay processes text request:**
   - Relay sends message to OpenClaw
   - Relay streams `session/update` notifications on `relay` data channel
5. **Mobile UI updates:**
   - Show streaming text response
   - Dim/hide voice waveform

**Diagram:**
```
Mobile                 Relay                 Agent                Room Metadata
  │                      │                     │                        │
  │ session/new ────────▶│                     │                        │
  │                      │ Check mode          │                        │
  │                      │ (mode="voice")      │                        │
  │                      │                     │                        │
  │                      │ Set mode="chat" ───────────────────────────▶ │
  │                      │                     │◀─── metadata update ───│
  │                      │                     │                        │
  │                      │                     │ Send agent_warm_down ──▶│
  │◀─────────────────────│ session/update     │                        │
  │                      │                     │ (idle, preparing to    │
  │                      │                     │  disconnect)           │
```

---

### Handoff 2: Chat → Voice

**Trigger:** User presses talk button while in chat mode.

**Steps:**

1. **Mobile publishes voice audio** (microphone stream)
2. **Agent dispatch service detects voice activity:**
   - Agent joins room (if not already present)
   - Agent checks room metadata (`mode === "chat"`)
3. **Agent sets `mode = "voice"`** (takes over)
4. **Relay receives metadata update event:**
   - Relay stops processing new chat requests
   - Relay remains in room (passive, ready for next handoff)
5. **Agent processes voice input:**
   - STT → LLM → TTS
   - Publishes `ganglia-events` (status, transcripts, artifacts)
6. **Mobile UI updates:**
   - Show voice waveform
   - Hide text input (or show dimmed/inactive state)

**Diagram:**
```
Mobile                 Agent                 Relay                Room Metadata
  │                      │                     │                        │
  │ Start talking ──────▶│                     │                        │
  │ (audio stream)       │                     │                        │
  │                      │ Join room           │                        │
  │                      │ Check mode          │                        │
  │                      │ (mode="chat")       │                        │
  │                      │                     │                        │
  │                      │ Set mode="voice" ──────────────────────────▶ │
  │                      │                     │◀─── metadata update ───│
  │                      │                     │ (passive mode)         │
  │                      │                     │                        │
  │◀─────────────────────│ ganglia-events      │                        │
  │ (agent transcript)   │                     │                        │
```

---

### Handoff 3: Idle → Voice (First Interaction)

**Trigger:** User presses talk button when room is idle.

**Steps:**

1. **Mobile publishes voice audio**
2. **Agent dispatch service activates agent**
3. **Agent joins room, checks metadata (`mode === "idle"`)**
4. **Agent sets `mode = "voice"`**
5. **Relay NOT in room yet** (joins only when token server signals on chat request)

**Diagram:**
```
Mobile                 Agent                 Room Metadata
  │                      │                        │
  │ First talk ─────────▶│                        │
  │                      │ Join room              │
  │                      │ Check mode (idle)      │
  │                      │                        │
  │                      │ Set mode="voice" ─────▶│
  │◀─────────────────────│ Process voice          │
  │                      │                        │
```

---

### Handoff 4: Idle → Chat (First Interaction)

**Trigger:** User types a message when room is idle (no agent present).

**Steps:**

1. **Mobile sends `session/new` request on `relay` data channel**
2. **Relay joins room** (auto-joined via LiveKit webhook)
3. **Relay checks metadata (`mode === "idle"`)**
4. **Relay sets `mode = "chat"`**
5. **Agent NOT in room** (will join later if user switches to voice)

**Diagram:**
```
Mobile                 Relay                 Room Metadata
  │                      │                        │
  │ session/new ────────▶│                        │
  │                      │ Join room              │
  │                      │ Check mode (idle)      │
  │                      │                        │
  │                      │ Set mode="chat" ──────▶│
  │◀─────────────────────│ session/update         │
  │                      │                        │
```

---

## Metadata Update Events

**LiveKit SDK Support:**

All three participants (mobile, agent, relay) can subscribe to metadata change events:

**Mobile (Flutter):**
```dart
room.addListener(() {
  final newMetadata = room.metadata;
  // React to metadata change
  _updateUIForMode(newMetadata);
});
```

**Relay (Bun):**
```typescript
room.on('roomMetadataChanged', (metadata: string) => {
  const data = JSON.parse(metadata || '{}');
  if (data.mode === 'voice') {
    console.log('Voice mode activated, relay entering passive state');
    // Stop processing new chat requests
  }
});
```

**Agent (Python):**
```python
@room.on('room_metadata_changed')
def on_metadata_changed(metadata: str):
    data = json.loads(metadata or '{}')
    if data.get('mode') == 'chat':
        logger.info('Chat mode activated, agent entering passive state')
        # Trigger warm-down
```

---

## Conflict Resolution

### Scenario: Agent and Relay Both Try to Activate

**Example:**
1. Room is idle
2. User starts talking (agent sets `mode = "voice"`)
3. User immediately types message (relay tries to set `mode = "chat"`)
4. Race condition!

**Resolution:**

**LiveKit guarantees:** Last write wins (atomic metadata update)

**Protocol:**
1. **Relay checks metadata BEFORE every request:**
   ```typescript
   const metadata = JSON.parse(room.metadata || '{}');
   if (metadata.mode === 'voice') {
     // Reject request with error
     return {
       jsonrpc: '2.0',
       error: { code: -32003, message: 'Voice mode active' },
       id: request.id
     };
   }
   ```

2. **Agent checks metadata BEFORE every LLM request:**
   ```python
   metadata = json.loads(room.metadata or '{}')
   if metadata.get('mode') == 'chat':
       logger.warning('Chat mode active, skipping LLM request')
       return  # Skip this turn
   ```

3. **Retry Logic:**
   - If metadata changes between check and LLM request → abort request
   - Surface error to user: "Mode switched, please retry"
   - Mobile app can auto-retry after brief delay (100ms)

**Invariant:** Only one participant should have `mode` set to their type at any time.

---

## Schema Validation

**Required Fields:**
```typescript
{
  mode: "voice" | "chat" | "idle" | null
}
```

**Optional Future Fields:**
```typescript
{
  mode: "voice" | "chat" | "idle";
  activeParticipant?: string;  // SID of the participant handling LLM (for debugging)
  lastHandoff?: number;        // Unix timestamp of last mode switch
  capabilities?: string[];     // ["voice", "chat", "video"] (future multi-modal support)
}
```

**Validation (Relay):**
```typescript
function validateMetadata(metadata: any): boolean {
  if (typeof metadata !== 'object') return false;
  if (!['voice', 'chat', 'idle', null].includes(metadata.mode)) return false;
  return true;
}
```

---

## Implementation Notes

### For Task R-011 (Idle Timeout)

**Relay Idle Timeout:**
- When `mode === "chat"` and no messages for 5 minutes:
  1. Relay sets `mode = "idle"`
  2. Relay disconnects from room
  3. Next chat request → user rejoins room → webhook triggers relay rejoin

**Agent Idle Timeout (Epic 20):**
- When `mode === "voice"` and no voice activity for 5 minutes:
  1. Agent sends `agent_idle_warning` on `ganglia-events` data channel
  2. After 30s grace period → Agent sets `mode = "idle"` and disconnects

### For Task R-012 (Webhook Auto-Join)

**Relay is self-driving via LiveKit webhooks:**
- LiveKit sends `participant_joined` webhook → relay auto-joins the room
- No token server signaling needed — the relay watches LiveKit directly
- `POST /relay/join` still exists as a manual override for debugging/testing
- Relay joins room, checks metadata, waits for first message before setting `mode = "chat"`

---

## Testing Scenarios

### Test 1: Voice Mode Active, Chat Request Arrives

**Setup:**
- Agent is in room, `mode = "voice"`
- User types a message

**Expected:**
- Relay returns JSON-RPC error: `{ code: -32003, message: "Voice mode active" }`
- Mobile shows error toast: "Voice mode active, please finish speaking first"

### Test 2: Chat Mode Active, Voice Request Arrives

**Setup:**
- Relay is in room, `mode = "chat"`
- User presses talk button

**Expected:**
- Agent sets `mode = "voice"` (takes over)
- Relay receives metadata update, enters passive state
- Mobile switches to voice UI

### Test 3: Simultaneous Requests (Race Condition)

**Setup:**
- Room is idle
- User presses talk button AND types message at the same time

**Expected:**
- One of them wins (last write to metadata)
- Loser receives error and retries after brief delay
- No double-processing of LLM requests

### Test 4: Metadata Corruption Recovery

**Setup:**
- Room metadata is set to invalid JSON (`"{mode: voice"` — missing quote)

**Expected:**
- Relay catches JSON parse error, treats as `mode = "idle"`
- Relay logs warning, sets metadata to valid JSON: `{"mode":"chat"}`

---

## Verification Checklist

- [x] Metadata key `"mode"` chosen (simple, descriptive)
- [x] Three mode values defined: `"voice"`, `"chat"`, `"idle"`
- [x] State machine covers all transitions (idle ↔ voice ↔ chat)
- [x] Handoff protocols specify who sets metadata and when
- [x] Conflict resolution uses last-write-wins + pre-request metadata checks
- [x] Mobile is read-only (does not set metadata)
- [x] Agent and relay both check metadata before every LLM request
- [x] Metadata update events trigger passive state in non-active participant

**Status:** Ready for implementation (Tasks R-011, R-012, voice agent updates)
