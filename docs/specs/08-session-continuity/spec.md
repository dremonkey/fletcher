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

The "owner" is a special participant identity established during onboarding. Fletcher stores this identity locally and compares it against participants in the room.

**Onboarding flow:**

1. First launch → owner identifies themselves (voice fingerprint, passphrase, or manual config)
2. Fletcher stores the owner identity (e.g., `"andre"`) in local device config
3. On every room join, Fletcher checks: is the owner's identity among the participants?

**Implementation:** The owner identity is a participant identity string set in the LiveKit token. The agent (ganglia) inspects `room.participants` on join and applies routing rules.

**Related mechanisms:**

- [Voice Fingerprinting](../06-voice-fingerprinting/spec.md) — can serve as the onboarding mechanism. The owner's voiceprint is captured during enrollment and used for continuous speaker verification. When the fingerprint engine identifies a participant as the owner (confidence >0.75), the agent can treat them as the owner without relying solely on the token identity.
- [Sovereign Pairing](../07-sovereign-pairing.md) — provides cryptographic device authentication. A paired device's token already carries a verified identity, which the agent can trust for owner detection without additional fingerprinting.

### Session Key Resolution

The agent resolves a session key using this priority:

```
fn resolveSessionKey(room, config):
  participants = room.remoteParticipants + room.localParticipant
  ownerPresent = any(p.identity == config.ownerIdentity for p in participants)
  participantCount = len(participants)

  if participantCount == 1:
    if ownerPresent:
      return SessionKey(type: "owner", key: "main")
    else:
      return SessionKey(type: "guest", key: "guest:{participant.identity}")

  else:  // multi-user
    return SessionKey(type: "room", key: "room:{room.name}")
```

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

- [Voice Fingerprinting](../06-voice-fingerprinting/spec.md) — speaker identification for owner detection and context injection
- [Sovereign Pairing](../07-sovereign-pairing.md) — device authentication and token minting with stable identity
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
