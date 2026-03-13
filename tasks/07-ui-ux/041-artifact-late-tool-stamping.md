# Task 041: Fix Late Tool-Call Artifact Stamping (BUG-012 Remaining)

## Problem

Commit `a690d4d` partially fixed BUG-012 by (a) reclassifying error events as `system_event` and (b) adding server-side `segmentId` stamping in `publishEvent()`. However, two remaining issues cause artifacts from tool calls to "float" to the latest agent message:

1. **`TranscriptManager.activeSegmentId` returns null after stream finalization.** Tool calls execute asynchronously — the LLM stream often finalizes before the tool completes. `finalizeStream()` deletes the segment from `streamSegments`, so `activeSegmentId` returns `null`. The artifact is published without a `segmentId`.

2. **`_groupArtifactsByMessage` fallback re-assigns on every rebuild.** When an artifact has `messageId = null`, the fallback at `chat_transcript.dart:120` assigns it to `lastAgentId` (the current last agent message). As new agent messages arrive, the artifact "follows" the latest message.

**Field test:** [BUG-012](../../docs/field-tests/20260313-buglog.md) (recurring regression)
**Prior tasks:** 023 (initial fix), 038a (reconnect fix)

## Investigation

### Chain of events for remaining bug

```
T=0     LLM stream starts, pondering → onContent fires, segment exists
T=1s    LLM stream finalizes (onPondering(null) + contentStarted=true)
        → finalizeStream() deletes segment from streamSegments map
T=2s    Tool call completes asynchronously, emits artifact via publishEvent()
T=2s    publishEvent() checks transcriptMgr.activeSegmentId
        → activeStreamId is set, but streamSegments.get(activeStreamId) returns undefined
        → activeSegmentId returns null
T=2s    Artifact published without segmentId
T=2s    Mobile receives artifact: serverSegmentId=null, _lastAgentSegmentId may be correct
        → but if _lastAgentSegmentId is also null (race), messageId stays null
T=Ns    On every ChatTranscript rebuild, _groupArtifactsByMessage fallback assigns
        orphaned artifact (messageId=null) to whatever lastAgentId is current
```

### Code references

- `transcript-manager.ts:128-141`: `finalizeStream()` deletes segment
- `transcript-manager.ts:148-152`: `activeSegmentId` getter returns null when segment deleted
- `agent.ts:178`: Server-side stamping: `event.segmentId = transcriptMgr.activeSegmentId`
- `livekit_service.dart:878-884`: Client-side fallback: `serverSegmentId ?? _lastAgentSegmentId`
- `chat_transcript.dart:119-120`: Rebuild fallback: `artifact.messageId ?? lastAgentId`

## Proposed Fix

### Part 1: Preserve last finalized segment ID (voice-agent)

**File:** `apps/voice-agent/src/transcript-manager.ts`

Add a `lastFinalizedSegmentId` field that remembers the most recent segment ID after finalization:

```typescript
// Add field:
private lastFinalizedSegmentId: string | null = null;

// In finalizeStream(), before deleting:
this.lastFinalizedSegmentId = `seg_${seg.segId}`;
this.streamSegments.delete(streamId);

// Update activeSegmentId getter:
get activeSegmentId(): string | null {
  if (!this.activeStreamId) return this.lastFinalizedSegmentId;
  const seg = this.streamSegments.get(this.activeStreamId);
  return seg ? `seg_${seg.segId}` : this.lastFinalizedSegmentId;
}
```

This ensures late-arriving tool artifacts are stamped with the correct segment ID even after the stream that spawned them has finalized.

### Part 2: Stamp orphaned artifacts once (mobile)

**File:** `apps/mobile/lib/services/livekit_service.dart`

In the artifact handler, when both `serverSegmentId` and `_lastAgentSegmentId` are null, stamp with a synthetic orphan ID to prevent the rebuild fallback from re-assigning:

```dart
final serverSegmentId = json['segmentId'] as String?;
final targetId = serverSegmentId ?? _lastAgentSegmentId ?? 'orphan_${DateTime.now().millisecondsSinceEpoch}';
```

This ensures every artifact gets a `messageId` on arrival, so `_groupArtifactsByMessage`'s fallback path never fires.

## Edge Cases

- **New stream starts before tool completes:** `lastFinalizedSegmentId` is overwritten by the new stream's finalization. But by that point, `_lastAgentSegmentId` on the client should have been updated by the new stream's transcript events, so the client fallback catches it.
- **Multiple concurrent tool calls:** All share the same `lastFinalizedSegmentId`, which is correct — they were all triggered by the same LLM stream.
- **Orphan ID collision:** The timestamp-based orphan ID is unique enough (millisecond resolution) for a UI grouping key.

## Acceptance Criteria

- [ ] Artifacts from tool calls that complete after stream finalization are stamped with the correct segment ID
- [ ] Artifacts with `messageId = null` are not re-assigned to the latest message on rebuild
- [ ] Existing in-session artifact-to-message association is unchanged (regression check)
- [ ] Unit test: `activeSegmentId` returns finalized segment ID after `finalizeStream()`
- [ ] Unit test: orphan artifacts get synthetic ID and don't float

## Files

- `apps/voice-agent/src/transcript-manager.ts` — add `lastFinalizedSegmentId`
- `apps/voice-agent/src/transcript-manager.spec.ts` — test coverage
- `apps/mobile/lib/services/livekit_service.dart` — orphan artifact stamping

## Status

**Date:** 2026-03-13
**Priority:** Medium
**Status:** Not started
**Field test:** [BUG-012](../../docs/field-tests/20260313-buglog.md)
