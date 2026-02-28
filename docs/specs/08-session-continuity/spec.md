# Session Continuity & Room Reconnection

## Problem

LiveKit rooms are ephemeral — they close when the last participant leaves. But voice conversations should survive network drops, app backgrounding, and device restarts. The conversation state lives in the backend (OpenClaw, Nanoclaw, etc.), not in the room. Fletcher needs a way to map **new rooms** to **existing sessions** so users can pick up where they left off.

## Core Principle

> Rooms are disposable transport. Sessions are persistent state.

A LiveKit room is just a pipe for audio. The session (conversation history, memory, context) is owned by the backend. Fletcher's job is to resolve the correct session key when a room is created, so the backend can route the request to the right conversation.

## Session Routing Rules

Session routing depends on **who is in the room** and **whether the owner is present**.

| Scenario | Routing | Session Scope |
|---|---|---|
| Owner (solo) | Route to the owner's primary session | Full brain: memory, history, personality |
| Guest (solo) | Route to a guest-specific session | Isolated: no access to owner's memory |
| Multi-user room (including owner) | Route to a room-specific session | Shared context for that conversation |
| Multi-user room (guests only) | Route to a room-specific session | Shared context, no owner memory |

### Owner Detection

Owner detection requires verifying the **person speaking**, not just the device connecting. A paired device authenticates the hardware, but the device could be borrowed or stolen — routing a stranger to the owner's "main" session would leak sensitive context.

**Two-layer verification:**

| Layer | Mechanism | What it proves | Alone sufficient? |
|---|---|---|---|
| Device identity | [Sovereign Pairing](../07-sovereign-pairing.md) | "This is a known, paired device" | No |
| Speaker identity | [Voice Fingerprinting](../06-voice-fingerprinting/spec.md) | "The person speaking is the owner" | Configurable |
| Both | Device + voice match | "Known device, confirmed speaker" | Yes |

**Default behavior:** A paired device starts in **guest mode**. The agent upgrades the session to owner ("main") only after voice fingerprinting confirms the speaker with sufficient confidence (>0.75). This means:

1. User connects from a paired device → agent joins, routes to a guest session initially
2. User speaks → voice fingerprint engine processes audio
3. If speaker matches owner voiceprint → agent upgrades routing to "main" session
4. If no match or low confidence → remains in guest session

**Upgrade mid-conversation:** When the agent upgrades from guest to owner routing, it should seamlessly switch the backend session key. Any messages exchanged in the guest session before verification can be discarded or merged — this is an implementation detail.

**Fallback modes:** For environments without voice fingerprinting (e.g., early development, text-only), owner detection can fall back to:
- Manual config: `FLETCHER_OWNER_IDENTITY` env var matches participant identity (trust-on-connect, suitable for single-user local setups)
- Passphrase: Owner speaks a configured phrase to authenticate

**Onboarding flow:**

1. First launch → owner enrolls their voiceprint (speaks a few sentences)
2. Fletcher stores the voiceprint locally (see [Voice Fingerprinting spec](../06-voice-fingerprinting/spec.md) for enrollment)
3. Device is paired with the hub (see [Sovereign Pairing spec](../07-sovereign-pairing.md))
4. On every room join: device identity gets them in, voice identity determines session routing

### Session Key Resolution

Session routing is **dynamic** — it can change mid-conversation as speaker verification completes. The agent starts with an initial key and may upgrade it.

```
fn resolveSessionKey(room, speakerVerified, config):
  participants = room.remoteParticipants + room.localParticipant
  participantCount = len(participants)

  if participantCount == 1:
    if speakerVerified == "owner":
      return SessionKey(type: "owner", key: "main")
    else:
      // Not yet verified, or verified as non-owner
      return SessionKey(type: "guest", key: "guest:{participant.identity}")

  else:  // multi-user
    return SessionKey(type: "room", key: "room:{room.name}")
```

**`speakerVerified`** starts as `"unknown"` on connect and is updated by the voice fingerprint engine. In fallback mode (no fingerprinting), it can be set to `"owner"` immediately based on `FLETCHER_OWNER_IDENTITY` matching the participant identity.

The resolved `SessionKey` is then passed to the backend-specific client, which maps it to the appropriate header or request parameter.

## Session Lifecycle

```
┌─────────────────────────────────────────────────────────────┐
│                     Backend (OpenClaw / Nanoclaw)            │
│                                                             │
│   ┌─────────────────────────────────────────────────────┐   │
│   │              Session (persistent)                   │   │
│   │  - Conversation history                             │   │
│   │  - Memory                                           │   │
│   │  - Context                                          │   │
│   └──────────────────────┬──────────────────────────────┘   │
│                          │                                  │
│          ┌───────────────┼───────────────┐                  │
│          │               │               │                  │
│     Room A (dead)    Room B (active)  Room C (future)       │
│     10:00–10:15      10:20–now        ...                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Connect

1. Mobile app requests a LiveKit token (via Fletcher hub or token server)
2. App connects to a new room
3. Agent is dispatched to the room (via LiveKit agent dispatch)
4. Agent inspects participants, resolves session key
5. Agent sends first request to backend with session key
6. Backend loads or creates the session — conversation resumes or starts fresh

### Disconnect

1. App disconnects (network drop, backgrounded, closed)
2. Agent may linger briefly, then also leaves
3. Room closes (empty timeout)
4. Session persists in backend — nothing is lost

### Reconnect

1. App opens again, requests a new token
2. New room is created
3. Agent joins, resolves session key → same key as before (owner identity hasn't changed)
4. Backend receives request with same session key → loads existing session
5. Conversation continues seamlessly

## Backend Interface Contract

Any backend that supports session continuity must:

1. **Accept a session key** — via header, query param, or request body field
2. **Persist session state** — conversation history survives room teardown
3. **Resume on matching key** — when the same session key appears in a new request, load the existing conversation
4. **Isolate sessions** — different keys yield different conversation contexts

The mapping from `SessionKey` to backend-specific parameters is defined in each implementation spec.

## Fletcher Component Responsibilities

### Agent (ganglia)

- Inspect room participants on join
- Resolve session key using routing rules
- Pass session key to the backend client
- Handle session errors (expired, locked, not found)

### Mobile App

- Store owner identity locally after onboarding
- Request tokens with consistent participant identity
- No need to track session keys — the agent handles routing
- UI states: connecting, connected, reconnecting, disconnected

### Token Server / Hub

- Mint LiveKit tokens with the correct participant identity
- The identity must be stable across rooms for session routing to work
- See [Sovereign Pairing](../07-sovereign-pairing.md) for the device authentication flow that establishes identity before token minting

## Configuration

```jsonc
{
  "fletcher": {
    // The participant identity that maps to the owner's primary session
    "owner_identity": "andre",

    // Backend-specific config (see implementation specs)
    "backend": {
      "type": "openclaw",
      // ...
    }
  }
}
```

## Related Specs

- [Voice Fingerprinting](../06-voice-fingerprinting/spec.md) — speaker verification for owner detection (gates access to "main" session)
- [Sovereign Pairing](../07-sovereign-pairing.md) — device authentication (necessary but not sufficient for owner routing)
- [Brain Plugin](../04-livekit-agent-plugin/spec.md) — current session context management (`conversationId`, speaker attribution)
- [Nanoclaw Integration](../04-livekit-agent-plugin/nanoclaw-integration.md) — cross-channel history and JID-based channel separation
- [Channel Plugin](../02-livekit-agent/spec.md) — room-to-conversation mapping (1:1), current context management

### Supersedes

This spec replaces the current session identity model in the brain plugin, where session keys are derived from `roomSid:participantIdentity` (see [brain plugin spec](../04-livekit-agent-plugin/spec.md)). The new model derives keys from **participant identity + routing rules** rather than room identity, enabling session persistence across room reconnections.

## Open Questions

- **Session expiry:** Should old sessions ever be pruned, or are they permanent? Backend-dependent?
- **Session switching:** Can the owner explicitly start a "new conversation" instead of resuming? (e.g., a "New Chat" button in the app)
- **Participant changes:** If a guest joins an owner-solo room mid-conversation, does the session key change? (Probably not — would be disruptive. But the agent could adjust context visibility.)
- **Multiple devices:** If the owner connects from two devices simultaneously, both route to "main" — is that handled gracefully by the backend?
