# UX Spec: Handling Periods of Silence & Session Continuity

**Status:** Draft  
**Author:** Glitch (PM Agent)  
**Date:** 2026-03-13  
**Context:** Fletcher mobile/relay/agent interaction patterns

---

## Problem Statement

Silence in a conversational AI interface is ambiguous. Without clear feedback, users can't distinguish between:
- "The agent is done and waiting for me"
- "The agent is working on something complex"
- "The connection is broken"
- "I should say something else"

Additionally, network disconnects, app backgrounding, and session lifecycle events create discontinuities that must be handled gracefully to maintain the illusion of a persistent, always-available companion.

This spec catalogs silence scenarios and disconnect patterns, proposing UX affordances to handle each case without cluttering the conversation.

---

## Core Principles

1. **Rooms are disposable, sessions persist** — The LiveKit room can close, but the conversation continues in the backend
2. **Seamless reconnection for short drops** — Network flickers should be invisible to the user
3. **Push notifications for long-running work** — If the user initiated a task and left, notify them when done
4. **Graceful degradation** — If reconnection fails, provide clear feedback
5. **Chat is for conversation, status bar is for state** — Don't pollute the conversational thread with transient updates

---

## Scenario 1: End-of-Turn Silence (Legitimate Completion)

### Description
Agent has completed its response. User is done and has moved on (e.g., reading the response, acting on it, or simply finished with the conversation).

### Current State
No indicator. Silence is ambiguous.

### Proposed UX
- **Visual:** Subtle "ready" state indicator (e.g., microphone icon pulses gently green once)
- **Haptic:** Single soft haptic pulse when agent completes turn
- **Timeout:** After 30s of silence, fade to neutral/sleeping state
- **No chat clutter:** This is healthy silence—don't pollute chat with "Is there anything else?"

### What the User Sees

| Moment | Orb State | Status Bar | Notifications |
|--------|-----------|------------|---------------|
| Agent completes response | Idle glow | "Ready" | Single haptic pulse |
| 30s silence | Faded idle | - | None |

### Protocol Needs
- `turn_complete` signal from relay → mobile
- Mobile tracks "last interaction timestamp" for timeout logic

---

## Scenario 2: Long-Running Background Tasks

### User Story
> "I ask Fletcher to research a complex topic, then close the app and go make coffee. I want a push notification when the research is done, and when I reopen the app, I want to see the results immediately."

### User Journey

1. **Initiation**
   - User: "Fletcher, research ARM vs ESP32 for edge AI workloads and write a summary"
   - Orb: Pulses (processing) → "I'll dive into that. This might take a few minutes — I'll ping you when I'm done."
   - User backgrounds the app or closes it completely

2. **While Backgrounded**
   - App disconnects from LiveKit room
   - **Room closes** (last participant left)
   - **Agent continues working in backend** (session persists)
   - Backend tracks task completion state

3. **Task Completion**
   - Backend marks task as complete
   - **Push notification sent:** "✅ Fletcher: Research complete"
   - Notification includes preview text: "I found 3 key architectural differences between ARM and ESP32..."

4. **User Returns**
   - User taps notification → app opens
   - App connects to **new LiveKit room** with same session key
   - Agent joins, recognizes existing session
   - Orb animates (greeting state)
   - Agent: "Welcome back! I've finished that ARM vs ESP32 research. Here's what I found..." (delivers results immediately)

### What the User Sees

| Moment | Orb State | Status Bar | Notifications |
|--------|-----------|------------|---------------|
| Task initiated | Processing shimmer | "⚙️ Researching..." | Haptic pulse |
| App backgrounded | (App not visible) | N/A | None |
| Task completes (app closed) | (App not visible) | N/A | **Push notification** |
| User returns via notification | Greeting pulse → Speaking | Full conversation history + results | Completion haptic |

### What the Agent Does

1. **On task initiation:** 
   - Acknowledge the task and set expectation ("this might take a few minutes")
   - Mark session state as `taskStatus: "in-progress"`
2. **While working:** 
   - Continue processing in backend session (room disconnect doesn't stop work)
   - Emit periodic `background_task_update` signals (if user still connected)
3. **On completion:** 
   - Mark session state as `taskStatus: "complete"`
   - Store results in session
   - Trigger push notification via backend → FCM/APNs
4. **On reconnection:** 
   - Detect session has pending results
   - Greet user and deliver results immediately (don't wait for user to ask again)

### Background Task UX (While App Foreground)

If user stays in the app during a long task:
- **Visual:** Persistent "working" indicator in status bar
  - Example: "⚙️ Static is analyzing the codebase..." 
  - Progress hints when available (e.g., "2/5 files scanned")
- **Haptic:** Gentle pulse every 10-15s to reassure user the process is alive
- **Push Notification:** If process exceeds 2 minutes, send push: "Still working on [task]..."
- **Completion Signal:** Distinct haptic pattern when complete (two short pulses)
- **Chat Presence:** Only surface result in chat when done—don't spam "Still working..." messages

### Backend Requirements

- **Task state tracking:** Session must store `taskStatus: "in-progress" | "complete" | "failed"`
- **Notification dispatch:** Backend triggers push notification when task completes
- **Result persistence:** Results stored in session, delivered on reconnect
- **Session key stability:** Same participant identity → same session across rooms

### Protocol Needs
- `background_task_start` / `background_task_update` / `background_task_complete` signals
- Payload: `{ task_id, description, progress?, eta? }`
- Relay tracks active sub-agents and emits updates

### Implementation Status

| Component | Status | Notes |
|-----------|--------|-------|
| Backend session persistence | ✅ Implemented | OpenClaw/Nanoclaw maintain conversation history |
| Task state tracking | 🚧 Needs Implementation | Backend must track `taskStatus` |
| Push notification dispatch | 🚧 Needs Implementation | FCM/APNs integration required |
| Session resumption on reopen | 🚧 Needs Implementation | App should load previous session by default |

---

## Scenario 3: Network-Induced Silence (Disconnects & "Nose Holes")

### User Story
> "I'm talking to Fletcher while walking through my house. I pass through a dead zone (the 'nose hole') where WiFi drops for 2-3 seconds. The conversation should NOT break — it should reconnect instantly and keep going."

### User Journey

1. **Active Conversation**
   - User and agent are mid-conversation
   - Audio flowing normally

2. **Network Drop**
   - WiFi cuts out (e.g., walking between access points)
   - LiveKit detects disconnection
   - Mobile loses WebSocket heartbeat

3. **Reconnection Attempt**
   - App attempts immediate reconnection
   - **Grace period:** 5-10 seconds before showing error
   - LiveKit SDK uses built-in reconnection logic
   - If reconnection succeeds within grace period → seamless resume

4. **Successful Reconnect**
   - **Same LiveKit room** (if still alive) OR **new room + same session key**
   - Audio resumes
   - No visible interruption to user

5. **Failed Reconnect (Network still down)**
   - After grace period (~10s), orb transitions to error state
   - User sees "Connection lost" message in status bar (subtle, not alarming)
   - App continues retrying in background with exponential backoff

### What the User Sees

| Moment | Orb State | Status Bar | Notifications |
|--------|-----------|------------|---------------|
| Network drops | Idle/listening (no change for first ~5s) | No change | None |
| Grace period (5-10s) | Subtle "reconnecting" indicator (dimmed orb?) | "🔄 Reconnecting..." | None |
| Reconnect succeeds | Normal state (idle/listening/speaking) | Clear status bar | Single haptic pulse |
| Reconnect fails | Error state (red tint) | "❌ Connection lost — retrying..." | Error haptic pattern |

### What the Agent Does

1. **On disconnect:** Nothing immediately (wait for reconnect)
2. **On reconnect (same room):** Resume mid-sentence if possible
3. **On reconnect (new room):** Same session key → backend loads same context, continue conversation
4. **If user speaks before agent reconnects:** Queue the audio, send when reconnected

### Detection & Health Monitoring

**Mobile Side:**
- No WebSocket heartbeat for 15s → "Connection degraded"
- Track "last seen" timestamp

**Relay Side:**
- No agent response for 30s → "Agent unresponsive"
- Can kill zombie session and spawn fresh one

**Heartbeat Protocol:**
```
Mobile → Relay: PING (every 10s)
Relay → Mobile: PONG (include relay health metrics)

Relay → Agent: PING (every 10s)
Agent → Relay: PONG
```

### Auto-Recovery Strategy

**Reconnection Timing:**
- **Retry aggressively for 2-3 minutes** (user might be moving through a temporary dead zone)
- After 3 failed attempts, show manual "Reconnect" button
- If app is backgrounded, stop retrying (preserve battery)

**Zombie Prevention:**
- If agent becomes unresponsive after reconnect, relay kills session and spawns fresh one
- Mobile detects and surfaces this recovery seamlessly

### Implementation Status

| Component | Status | Notes |
|-----------|--------|-------|
| LiveKit SDK reconnection | ✅ Built-in | LiveKit handles room reconnection |
| Session key resolution | ✅ Implemented | Routing rules exist in spec.md |
| Reconnection grace period | 🚧 Needs Implementation | App UI shouldn't show error for ~5-10s |
| Reconnecting state | 🚧 Low Priority | Orb animation for "reconnecting" (nice-to-have) |
| Bidirectional heartbeat | 🚧 Needs Implementation | WebSocket + session-level pings |

---

## Scenario 4: Idle Exit (Session Persistence)

### User Story
> "I finish a conversation with Fletcher, then lock my phone and walk away. No task is running. When I come back later, I want to seamlessly continue the conversation."

### User Journey

1. **Conversation Ends**
   - User: "Thanks, that's all I needed."
   - Orb: "Happy to help!"
   - User locks phone or backgrounds app (no explicit "hang up")

2. **While Idle**
   - App stays connected briefly (grace period: ~30s)
   - If no activity, app disconnects from room
   - **Room closes**
   - **Session persists in backend** (no tasks running, just idle)

3. **User Returns (Minutes/Hours Later)**
   - User opens app
   - App connects to **new LiveKit room** with same session key
   - Agent joins, recognizes existing session
   - Orb: Idle glow (no proactive greeting unless configured)
   - User can resume conversation naturally

### What the User Sees

| Moment | Orb State | Status Bar | Notifications |
|--------|-----------|------------|---------------|
| Conversation ends | Idle glow | "Ready" | None |
| App backgrounded | (App not visible) | N/A | None |
| App reopened (later) | Idle glow | **Full history preserved** | None |

### What the Agent Does

1. **On idle disconnect:** Nothing — session persists quietly
2. **On reconnection:** 
   - Load existing session silently
   - Return to idle state
   - Don't proactively speak unless:
     - New information arrived (e.g., scheduled reminder)
     - User configured "greeting on return"

### Greeting Behavior (Open Question)

**Should the agent greet the user on return after a long idle period?**

Options:
- **A) Silent reconnection** — Orb goes to idle, waits for user to speak (minimalist, non-intrusive)
- **B) Greeting after long gap** — If >1 hour idle, agent says "Welcome back!" (friendly, but might feel chatty)
- **C) User-configured** — Setting in app: "Greet me when I return" (most flexible)

**Current Recommendation:** Start with **(A)** — silent reconnection. If user feedback indicates people want greetings, add **(C)** as a setting.

### Backend Requirements

- **Session persistence:** Conversation history survives indefinitely (or until explicit session clear)
- **No state changes:** Idle disconnect doesn't trigger any backend action

### Implementation Status

| Component | Status | Notes |
|-----------|--------|-------|
| Session persistence | ✅ Implemented | Backend maintains history |
| Session resumption | 🚧 Needs Implementation | App should auto-load previous session |

---

## Scenario 5: Intended Exit (Explicit Session End)

### User Story
> "I'm done talking to Fletcher. I tap 'Hang Up' or close the app intentionally. The session should save, but the agent should NOT keep working in the background or send notifications."

### User Journey

1. **User Ends Session**
   - Option A: User taps "Hang Up" button (if we add one)
   - Option B: User force-closes app (swipe away from recent apps)

2. **Immediate Cleanup**
   - App disconnects from LiveKit room
   - **Room closes**
   - **Session persists in backend** BUT marked as `endedByUser: true`

3. **Backend Behavior**
   - If agent was mid-task → **cancel task** (user explicitly exited)
   - No push notifications sent
   - Session history saved, but no further processing

4. **Next Time User Opens App**
   - App can either resume previous session OR start fresh (UX decision pending)

### What the User Sees

| Moment | Orb State | Status Bar | Notifications |
|--------|-----------|------------|---------------|
| User taps "Hang Up" | Fade out animation | "Session saved" | None |
| App force-closed | (App not visible) | N/A | None |
| App reopened later | Idle glow | Previous session history (if resuming) | None |

### What the Agent Does

1. **On explicit hang-up:** 
   - Send session state to backend with `endedByUser: true`
   - Cancel any in-progress tasks
   - Close room cleanly

2. **On force-close (app killed):** 
   - Agent detects participant left
   - After timeout (~30s), assume intentional exit
   - Mark session as idle, don't trigger notifications

### Design Questions

**1. Should Fletcher have an explicit "Hang Up" button?**

Options:
- **A) No button** — Voice-first, just close the app (minimalist, matches vision)
- **B) Subtle button** — Small "End Session" in top corner (clear intent, but adds UI)
- **C) Voice command** — User says "Goodbye" or "Hang up" to end session (voice-first, but might conflict with polite farewells)

**Current Recommendation:** **(A)** — No button. Closing the app is the hang-up. If user says "goodbye," treat it as polite conversation end, not session termination.

**2. Should sessions auto-resume or start fresh each time?**

Options:
- **A) Always resume** — Opening app reconnects to last session (continuity)
- **B) Start fresh after long idle** — If >24h since last activity, new session (cleaner)
- **C) User choice** — "New conversation" button in app (flexible)

**Current Recommendation:** **(A)** — Always resume. Sessions are persistent until user explicitly clears them (future feature: "Clear History" in settings).

### Backend Requirements

- **Task cancellation:** If session ends mid-task, abort any long-running work
- **Session state:** Track `sessionStatus: "active" | "idle" | "ended-by-user"`

### Implementation Status

| Component | Status | Priority | Notes |
|-----------|--------|----------|-------|
| Task cancellation on exit | 🚧 Needs Implementation | Medium | Backend needs to respect `endedByUser` flag |

---

## Scenario 6: Agent Thinking / Processing Silence

### Description
Agent is reasoning, waiting for model response, or executing tool calls.

### Sub-Scenarios

#### 6a. Model Latency (0-5s)
**Context:** Waiting for Claude API to return first token

**Proposed UX:**
- **Visual:** Classic "typing dots" animation in status bar
- **Haptic:** None (too brief)
- **Timeout:** If >10s, escalate to 6b state

#### 6b. Deep Reasoning (5-30s)
**Context:** Extended thinking mode enabled

**Proposed UX:**
- **Visual:** "🤔 Thinking deeply..." (status bar, not chat)
- **Haptic:** Gentle pulse at 10s mark to reassure user
- **Timeout:** If >30s, escalate to background task (Scenario 2)

#### 6c. Tool Execution (variable)
**Context:** Running shell commands, searching, reading files

**Proposed UX:**
- **Visual:** Context-aware status
  - "🔍 Searching..."
  - "📂 Reading file..."
  - "⚡ Running command..."
- **Haptic:** Pulse at start, pulse at completion
- **Timeout:** Tool-specific (e.g., `exec` can be long, `read` should be fast)

#### 6d. Tool Chaining (10s+)
**Context:** Multiple sequential tool calls

**Proposed UX:**
- **Visual:** Show active tool step
  - "Step 1/3: Searching codebase..."
  - "Step 2/3: Analyzing results..."
- **Haptic:** Pulse on each step transition
- **Timeout:** Surface as background task if >1 minute

### Protocol Needs
- `agent_state` signal from relay → mobile
  - States: `idle`, `thinking`, `tool_execution`, `reasoning`
  - Payload: `{ state, context?, step?, total_steps? }`
- Agent/relay emit state changes in real-time
- Mobile renders appropriate indicator per state

---

## Scenario 7: Long-Running Tool Execution

### Description
Tools like `exec` with long-running commands (e.g., `npm install`, `git clone`, large file processing).

### Current State
Silent wait. User has no idea if it's working.

### Proposed UX
- **Visual:** Progressive disclosure
  - First 10s: "⚡ Running command..."
  - 10-60s: "Still running... (30s elapsed)"
  - >60s: Promote to background task (see Scenario 2)
- **Haptic:** Pulse every 30s for commands >60s
- **Streaming Output:** For interactive commands, stream partial output to chat
  - Example: Show `npm install` progress logs in real-time
- **Cancellation:** Offer "Cancel" button for long-running commands

### Protocol Needs
- Tool execution status stream from agent → relay → mobile
- Payload: `{ tool, command, elapsed_time, partial_output? }`
- Mobile renders inline or as background task based on duration

---

## Scenario 8: Deliberate User Pause (User is Formulating)

### Description
User is thinking, typing slowly, or gathering their thoughts. No agent action needed.

### Current State
Agent might interrupt with "Did you need something?"

### Proposed UX
- **Visual:** Neutral "listening" state (subtle microphone indicator)
- **Haptic:** None (don't distract user)
- **Timeout:** 
  - After 60s, fade microphone indicator to neutral
  - After 5 minutes, agent can offer gentle prompt: "Still here when you're ready 👋"
  - After 30 minutes, go fully dormant (no prompts)

### Protocol Needs
- Mobile tracks user input events (typing, voice activity)
- Suppress agent heartbeat prompts if user recently interacted

---

## Scenario 9: Multi-Modal Transition Silence

### Description
User switches from voice to text input (or vice versa) mid-conversation.

### Current State
Agent might not detect the switch, leading to confusion.

### Proposed UX
- **Visual:** Clear indicator of active input mode
  - "🎤 Voice" vs "⌨️ Text"
- **Haptic:** Single pulse when mode changes
- **Seamless Handoff:** Agent should detect and adapt (e.g., stop listening if user starts typing)

### Protocol Needs
- `input_mode_change` signal from mobile → relay
- Agent context includes current input mode

---

## Scenario 10: Relay Degradation

### Description
Relay is overloaded, slow, or struggling (high latency, CPU throttling).

### Current State
User experience degrades with no explanation.

### Proposed UX
- **Detection:** Relay tracks response time latency
  - <200ms: Healthy
  - 200-500ms: Degraded
  - >500ms: Critical
- **Visual:** Status indicator in app
  - Green: Healthy connection
  - Yellow: Slower than usual
  - Red: Significant delays
- **Haptic:** None (don't add to cognitive load)
- **Mitigation:** 
  - Relay can surface degradation reason: "High server load"
  - Auto-scale relay if self-hosted (future)

### Protocol Needs
- `relay_health` periodic signal from relay → mobile
- Payload: `{ latency_ms, load?, status }`

---

## Scenario 11: Model API Latency

### Description
Claude API (or other LLM provider) is slow or rate-limited.

### Current State
User thinks Fletcher is broken.

### Proposed UX
- **Visual:** Context-aware message
  - "⏳ Claude is a bit slow right now..."
  - "🚦 Rate limited — waiting 30s..."
- **Haptic:** Single pulse when API delay exceeds 10s
- **Timeout:** If API doesn't respond in 60s, surface error with retry option

### Protocol Needs
- Agent/relay detect API response time
- Emit `api_slow` or `api_rate_limited` state
- Mobile surfaces gracefully

---

## Decision Matrix: Push Notifications vs. Seamless Reconnection

| Scenario | Push Notification? | Seamless Reconnection? | Why |
|----------|-------------------|------------------------|-----|
| **Long-running task completes** | ✅ Yes | ✅ Yes (on return) | User needs to know it's done + see results |
| **Idle exit** | ❌ No | ✅ Yes | Nothing to notify, just restore history |
| **Network flicker** | ❌ No | ✅ Yes | User is present, fix it invisibly |
| **Intended exit** | ❌ No | ⚠️ Only if user reopens | Respect the exit |
| **Agent thinking** | ❌ No | N/A | Status bar feedback only |
| **Tool execution (<2m)** | ❌ No | N/A | Status bar feedback only |
| **Tool execution (>2m)** | ⚠️ Optional | ✅ Yes | Offer notification if user backgrounds |

---

## Timeout Ladder (Escalation Strategy)

Different silences require different patience:

| Duration | State | UX Response |
|----------|-------|-------------|
| 0-5s | Model response lag | Typing dots |
| 5-15s | Active thinking | "Thinking..." status |
| 15-30s | Deep reasoning | "Thinking deeply..." + haptic pulse |
| 30s-2m | Background task | Progress indicator + periodic pulses |
| 2-5m | Long background task | Push notification option |
| 5m+ | Timeout risk | Surface error, offer retry |

**Adaptive Timeout:** Context-aware escalation (e.g., `git clone` gets longer grace period than `read file`)

---

## Status Bar vs Chat: Content Placement Rules

**Guiding Principle:** Chat is for conversation. Status bar is for state.

### Chat (Persistent)
- Final agent responses
- User messages
- Completed task results
- Errors requiring user action

### Status Bar (Ephemeral)
- Connection state
- Current agent state (thinking, working)
- Background task progress
- Relay health warnings
- Input mode indicator
- Reconnection status
- Model API delays

**Why:** Avoids polluting the conversational thread with transient status updates.

---

## Proposed Protocol: Heartbeat & Pulse System

### Heartbeat (Connection Health)

**Purpose:** Ensure WebSocket and session liveness.

**Frequency:** Every 10 seconds

**Flow:**
```
Mobile → Relay: PING
Relay → Mobile: PONG (include relay health metrics)

Relay → Agent: PING
Agent → Relay: PONG
```

**Failure Handling:**
- Missed heartbeat → Retry after 5s
- 3 missed heartbeats → Connection lost state
- Auto-reconnect with exponential backoff

---

### Pulse (User Reassurance)

**Purpose:** Provide gentle feedback during long waits without cluttering chat.

**Types:**
1. **Thinking Pulse:** Agent is processing (every 10-15s)
2. **Working Pulse:** Background task active (every 15-20s)
3. **Completion Pulse:** Distinct pattern when task completes
4. **Error Pulse:** Distinct pattern for errors

**Rendering:**
- **Haptic:** Subtle vibrations (user can disable in settings)
- **Visual:** Status bar indicator (not chat messages)
- **Audio:** Optional subtle sound (default off)

**Protocol Signal:**
```json
{
  "type": "pulse",
  "pulse_type": "thinking" | "working" | "complete" | "error",
  "context": "Optional description",
  "task_id": "For background tasks"
}
```

---

## User Preferences (Settings)

Allow users to customize their tolerance for feedback:

### Notification Style
- **Proactive:** More haptics, more status updates
- **Balanced:** Default behavior (recommended)
- **Minimal:** Only critical errors, no haptics

### Haptic Feedback
- On / Off toggle
- Intensity slider (if OS supports)

### Background Task Handling
- Always notify (push)
- Only notify if >5 minutes
- Never notify (I'll check back)

### Session Resumption
- Always resume last session (default)
- Start fresh after 24h idle
- Always start fresh

### Greeting on Return
- Silent (default)
- Greet after >1 hour idle
- Always greet

---

## Implementation Summary

### ✅ Already Built

| Component | Status | Location |
|-----------|--------|----------|
| Session key resolution | ✅ Implemented | `spec.md` — routing rules exist |
| Backend session persistence | ✅ Implemented | OpenClaw/Nanoclaw maintain conversation history |
| LiveKit reconnection | ✅ Built-in | LiveKit SDK handles room reconnection |
| Orb animations | ✅ Implemented | `ux.md` — states defined |

### 🚧 Needs Implementation

| Component | Priority | Relevant Scenarios | Notes |
|-----------|----------|-------------------|-------|
| **Push notification dispatch** | **High** | Long-running tasks (Scenario 2) | Backend needs FCM/APNs integration |
| **Task state tracking** | **High** | Long-running tasks (Scenario 2) | Backend must track `taskStatus` and trigger notifications |
| **Session resumption on reopen** | **High** | Idle exit (Scenario 4) | App should load previous session by default |
| **Bidirectional heartbeat protocol** | **High** | Network disconnects (Scenario 3) | WebSocket + session-level pings |
| **Agent state signals** | **Medium** | Agent thinking (Scenario 6) | Real-time state updates for UI |
| **Reconnection grace period** | **Medium** | Network flickers (Scenario 3) | App UI shouldn't show error for ~5-10s |
| **Task cancellation on exit** | **Medium** | Intended exit (Scenario 5) | Backend needs to respect `endedByUser` flag |
| **Tool execution progress** | **Low** | Long-running tools (Scenario 7) | Streaming output, cancellation |
| **Reconnecting state** | **Low** | Network flickers (Scenario 3) | Orb animation for "reconnecting" (nice-to-have) |

---

## Implementation Priority

### Phase 1 (MVP - Core Reliability)
- [ ] Bidirectional heartbeat protocol (Scenario 3)
- [ ] Task state tracking in backend (Scenario 2)
- [ ] Push notification dispatch (Scenario 2)
- [ ] Session resumption logic (Scenario 4)
- [ ] Reconnection grace period UI (Scenario 3)

### Phase 2 (Polish - User Feedback)
- [ ] Agent state signals (thinking, tool execution) (Scenario 6)
- [ ] Basic status bar rendering (all scenarios)
- [ ] End-of-turn haptic pulse (Scenario 1)
- [ ] Task cancellation on exit (Scenario 5)
- [ ] Timeout ladder logic (all scenarios)

### Phase 3 (Advanced - User Customization)
- [ ] User preference controls
- [ ] Tool execution progress & cancellation (Scenario 7)
- [ ] Connection health indicators (Scenarios 3, 10)
- [ ] Multi-modal transition detection (Scenario 9)
- [ ] Streaming tool output

---

## Open Questions for Andre

1. **Greeting behavior:** Should agent greet user on reconnection after long idle (>1 hour), or stay silent? (Scenario 4)
2. **Hang-up UX:** No button (close app = hang up) vs. explicit "End Session" button? (Scenario 5)
3. **Reconnection persistence:** How long should app retry after network drop? Current recommendation is 2-3 minutes then manual button. (Scenario 3)
4. **Session lifecycle:** Always resume previous session, or start fresh after 24h idle? Current recommendation is always resume. (Scenarios 4 & 5)
5. **Task cancellation:** If user force-closes app mid-task, should agent abort immediately or keep working for a grace period? Current recommendation is immediate abort. (Scenario 5)
6. **Haptic overload prevention:** How to prevent haptic fatigue during long sessions with multiple agents? Proposed: cap at 1 pulse per 10 seconds, merge overlapping signals.
7. **Zombie recovery:** Should relay auto-restart unresponsive agents, or surface error to user? Proposed: auto-restart once silently, surface on second failure. (Scenario 3)

---

## Success Metrics

- **Reduced Confusion:** User surveys report clarity on agent state
- **No Zombie States:** <1% of sessions end in unrecoverable connection loss
- **Appropriate Feedback:** Users report feeling informed without being spammed
- **Fast Recovery:** Average reconnection time <5 seconds
- **Background Task Reliability:** >95% of push notifications delivered when task completes
- **Session Continuity:** >99% of sessions resume successfully after backgrounding

---

## Related Specs

- `spec.md` - Session key resolution and routing rules
- `relay-protocol.md` - Signal definitions and protocol details (when created)
- `mobile-ui-patterns.md` - Visual implementation details (when created)
- `voice-interaction.md` - Voice-specific silence handling (when created)

---

## Changelog

- **2026-03-13:** Initial draft (Glitch)
- **2026-03-13:** Merged session continuity and disconnect scenarios into unified spec
