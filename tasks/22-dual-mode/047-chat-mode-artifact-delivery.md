# Task 047: Chat Mode Artifact Delivery

**Epic:** 22 — Dual-Mode Architecture
**Status:** [ ] Not started
**Priority:** Medium
**Depends on:** 054 (Mobile ACP Client)

## Problem

Artifacts (diffs, code blocks, search results) only arrive in voice mode via the `ganglia-events` data channel from the voice agent. In chat mode, the relay forwards `session/update` notifications with `content_chunk` text deltas, but has no mechanism for artifact delivery. Users in chat mode see text responses but never see artifacts.

## Current State

- **Voice mode:** Agent emits artifacts on `ganglia-events` topic → Flutter `_handleGangliaEvent()` → `ArtifactViewer` renders inline below originating message via `_groupArtifactsByMessage()`
- **Chat mode:** Relay forwards `session/update` with `kind: "content_chunk"` only → Flutter `RelayChatService` yields `RelayContentDelta` → text appended to transcript. No artifact events.

## Requirements

### Relay side (`apps/relay`)

- [ ] Detect artifact-bearing `session/update` notifications from ACP (need to identify the ACP `sessionUpdate` kind for artifacts — may be a new kind from OpenClaw, or embedded in `agent_message_chunk` content)
- [ ] Forward artifact updates to mobile as `session/update` with a distinguishable `kind` (e.g., `artifact`)
- [ ] Preserve artifact metadata (type, title, content) through the relay passthrough

### Mobile side (`apps/mobile`)

- [ ] `RelayChatService` emits a new `RelayArtifact` event type alongside `RelayContentDelta`
- [ ] `LiveKitService._sendViaRelay()` handles `RelayArtifact` events — creates `ArtifactData` and associates with current agent message
- [ ] `_groupArtifactsByMessage()` in `chat_transcript.dart` works with both voice-mode and chat-mode artifact sources
- [ ] `ArtifactViewer` renders chat-mode artifacts identically to voice-mode artifacts

## Open Questions

- What ACP `sessionUpdate` kind does OpenClaw use for artifacts? Need to check against a real ACP session that produces artifacts (e.g., code editing, search).
- Should the relay parse artifact content or pass it through opaquely? Opaque is preferred (relay doesn't interpret ACP content), but the mobile needs to know it's an artifact vs text.

## Files

- `apps/relay/src/bridge/relay-bridge.ts` — artifact forwarding logic
- `apps/mobile/lib/services/relay/relay_chat_service.dart` — new `RelayArtifact` event
- `apps/mobile/lib/services/livekit_service.dart` — artifact handling in `_sendViaRelay()`
- `apps/mobile/lib/widgets/chat_transcript.dart` — verify `_groupArtifactsByMessage()` handles both sources

## Acceptance Criteria

- [ ] Artifacts from ACP agent are forwarded through relay to mobile in chat mode
- [ ] Artifacts render inline below their originating agent message (same as voice mode)
- [ ] `ArtifactViewer` supports diff, code block, and search result types from relay
- [ ] Voice-mode artifact delivery is unchanged (no regression)
- [ ] Unknown artifact types are handled gracefully (logged, not crashed)
