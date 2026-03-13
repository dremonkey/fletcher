import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { TranscriptManager, type TranscriptManagerDeps } from './transcript-manager';

function makeDeps(): TranscriptManagerDeps & {
  events: Record<string, unknown>[];
  statuses: { action: string; detail?: string }[];
  stopAckCalls: number;
  logs: unknown[];
} {
  const events: Record<string, unknown>[] = [];
  const statuses: { action: string; detail?: string }[] = [];
  let stopAckCalls = 0;
  const logs: unknown[] = [];
  return {
    events,
    statuses,
    stopAckCalls,
    logs,
    publishEvent: (event) => events.push(event),
    publishStatus: (action, detail) => statuses.push({ action, detail }),
    stopAck: () => { stopAckCalls++; /* update the mutable ref */ deps.stopAckCalls = stopAckCalls; },
    logger: { info: (...args: unknown[]) => logs.push(args) },
  };
  // Self-reference so stopAck can update the counter on the returned object
  var deps: ReturnType<typeof makeDeps>;
  deps = undefined as any;
}

// Wrapper that properly links the self-reference
function createDeps() {
  const d = makeDeps();
  // Patch stopAck to use a closure over d
  let count = 0;
  d.stopAck = () => { count++; d.stopAckCalls = count; };
  return d;
}

describe('TranscriptManager', () => {
  let deps: ReturnType<typeof createDeps>;
  let mgr: TranscriptManager;

  beforeEach(() => {
    deps = createDeps();
    mgr = new TranscriptManager(deps);
  });

  // -------------------------------------------------------------------------
  // 1. Normal flow: pondering → content → finalize
  // -------------------------------------------------------------------------
  describe('normal flow', () => {
    it('publishes transcript events and finalizes on stream end', () => {
      // Stream starts pondering
      mgr.onPondering('Thinking...', 'stream-1');
      expect(deps.statuses).toEqual([{ action: 'thinking', detail: 'Thinking...' }]);
      expect(mgr._activeStreamId).toBe('stream-1');
      expect(mgr._segments.size).toBe(1);

      // First onPondering(null) — content about to start
      mgr.onPondering(null, 'stream-1');
      expect(deps.stopAckCalls).toBe(1);
      // Segment still exists (contentStarted is false, no finalize)
      expect(mgr._segments.size).toBe(1);

      // Content arrives
      mgr.onContent('Hello', 'Hello', 'stream-1');
      mgr.onContent(' world', 'Hello world', 'stream-1');

      expect(deps.events).toEqual([
        { type: 'agent_transcript', segmentId: 'seg_1', delta: 'Hello', text: 'Hello', final: false },
        { type: 'agent_transcript', segmentId: 'seg_1', delta: ' world', text: 'Hello world', final: false },
      ]);

      // Second onPondering(null) — stream done, should finalize
      mgr.onPondering(null, 'stream-1');
      expect(deps.stopAckCalls).toBe(2);
      expect(deps.events).toHaveLength(3);
      expect(deps.events[2]).toEqual({
        type: 'agent_transcript',
        segmentId: 'seg_1',
        delta: '',
        text: 'Hello world',
        final: true,
      });
      // Segment cleaned up
      expect(mgr._segments.size).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Pondering(null) before content — first call does NOT finalize
  // -------------------------------------------------------------------------
  describe('pondering(null) before content', () => {
    it('does not delete segment on first pondering(null)', () => {
      mgr.onPondering('Hmm...', 'stream-1');
      mgr.onPondering(null, 'stream-1');

      // Segment still alive, no transcript events emitted
      expect(mgr._segments.size).toBe(1);
      expect(deps.events).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Pondering(null) after content — second call DOES finalize
  // -------------------------------------------------------------------------
  describe('pondering(null) after content', () => {
    it('finalizes segment when contentStarted is true', () => {
      mgr.onPondering('Processing...', 'stream-1');
      mgr.onPondering(null, 'stream-1'); // first: pre-content
      mgr.onContent('Hi', 'Hi', 'stream-1');
      mgr.onPondering(null, 'stream-1'); // second: post-content

      const finalEvent = deps.events.find((e) => e.final === true);
      expect(finalEvent).toEqual({
        type: 'agent_transcript',
        segmentId: 'seg_1',
        delta: '',
        text: 'Hi',
        final: true,
      });
      expect(mgr._segments.size).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Interruption mid-content — new stream finalizes old
  // -------------------------------------------------------------------------
  describe('interruption mid-content', () => {
    it('finalizes old stream when new stream starts pondering', () => {
      // Stream 1 starts and emits content
      mgr.onPondering('First thought', 'stream-1');
      mgr.onPondering(null, 'stream-1');
      mgr.onContent('Part', 'Part', 'stream-1');

      // Stream 2 interrupts — stream 1 should be finalized
      mgr.onPondering('Second thought', 'stream-2');

      expect(mgr._activeStreamId).toBe('stream-2');
      expect(mgr._segments.has('stream-1')).toBe(false);

      // Verify finalization event for stream 1
      const finalEvent = deps.events.find(
        (e) => e.final === true && e.segmentId === 'seg_1',
      );
      expect(finalEvent).toEqual({
        type: 'agent_transcript',
        segmentId: 'seg_1',
        delta: '',
        text: 'Part',
        final: true,
      });

      // Stale callbacks from stream 1 are no-ops
      mgr.onContent('ial response', 'Partial response', 'stream-1');
      // No new events for stream 1 (segment deleted)
      const stream1ContentAfter = deps.events.filter(
        (e) => e.segmentId === 'seg_1' && e.final === false && e.delta === 'ial response',
      );
      expect(stream1ContentAfter).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // 5. Stale stream stopAck guard
  // -------------------------------------------------------------------------
  describe('stale stream stopAck guard', () => {
    it('does not call stopAck for non-active stream pondering(null)', () => {
      mgr.onPondering('First', 'stream-1');
      mgr.onPondering(null, 'stream-1');
      mgr.onContent('A', 'A', 'stream-1');

      // New stream becomes active
      mgr.onPondering('Second', 'stream-2');
      deps.stopAckCalls = 0; // reset counter

      // Stale stream-1 emits pondering(null) from its finally block
      mgr.onPondering(null, 'stream-1');

      // stopAck should NOT have been called — stream-1 is not active
      expect(deps.stopAckCalls).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // 6. Rapid interruptions — multiple streams created/abandoned
  // -------------------------------------------------------------------------
  describe('rapid interruptions', () => {
    it('handles multiple streams created and abandoned before content', () => {
      mgr.onPondering('A', 'stream-1');
      mgr.onPondering('B', 'stream-2'); // finalizes stream-1 (no text → no final event)
      mgr.onPondering('C', 'stream-3'); // finalizes stream-2 (no text → no final event)

      expect(mgr._activeStreamId).toBe('stream-3');
      // stream-1 and stream-2 had no text, so no final events
      expect(deps.events.filter((e) => e.final === true)).toHaveLength(0);
      // Only stream-3 segment remains
      expect(mgr._segments.size).toBe(1);
      expect(mgr._segments.has('stream-3')).toBe(true);

      // Stream 3 completes normally
      mgr.onPondering(null, 'stream-3');
      mgr.onContent('Final answer', 'Final answer', 'stream-3');
      mgr.onPondering(null, 'stream-3');

      const finalEvent = deps.events.find((e) => e.final === true);
      expect(finalEvent).toEqual({
        type: 'agent_transcript',
        segmentId: 'seg_3',
        delta: '',
        text: 'Final answer',
        final: true,
      });
    });

    it('handles rapid interruptions where each stream gets some content', () => {
      mgr.onPondering('A', 'stream-1');
      mgr.onPondering(null, 'stream-1');
      mgr.onContent('X', 'X', 'stream-1');

      mgr.onPondering('B', 'stream-2'); // finalizes stream-1 with text "X"
      mgr.onPondering(null, 'stream-2');
      mgr.onContent('Y', 'Y', 'stream-2');

      mgr.onPondering('C', 'stream-3'); // finalizes stream-2 with text "Y"

      const finals = deps.events.filter((e) => e.final === true);
      expect(finals).toHaveLength(2);
      expect(finals[0]).toMatchObject({ segmentId: 'seg_1', text: 'X' });
      expect(finals[1]).toMatchObject({ segmentId: 'seg_2', text: 'Y' });
    });
  });

  // -------------------------------------------------------------------------
  // 7. Content from deleted/unknown stream — silently ignored
  // -------------------------------------------------------------------------
  describe('content from unknown stream', () => {
    it('ignores onContent for unknown streamId', () => {
      mgr.onContent('ghost', 'ghost data', 'nonexistent-stream');
      expect(deps.events).toHaveLength(0);
    });

    it('ignores onContent for already-finalized stream', () => {
      mgr.onPondering('Go', 'stream-1');
      mgr.onPondering(null, 'stream-1');
      mgr.onContent('Data', 'Data', 'stream-1');
      mgr.onPondering(null, 'stream-1'); // finalize

      const eventCountAfterFinalize = deps.events.length;

      // Late content from finalized stream
      mgr.onContent('late', 'Data late', 'stream-1');
      expect(deps.events).toHaveLength(eventCountAfterFinalize);
    });
  });

  // -------------------------------------------------------------------------
  // 8. Monster scenario — old stream continues after 3+ new streams
  // -------------------------------------------------------------------------
  describe('monster: old stream survives many new streams', () => {
    it('old stream content is ignored after being superseded by 3+ streams', () => {
      // Stream 1 starts and gets some content
      mgr.onPondering('Alpha', 'stream-1');
      mgr.onPondering(null, 'stream-1');
      mgr.onContent('Old', 'Old', 'stream-1');

      // Streams 2, 3, 4 arrive in rapid succession
      mgr.onPondering('Beta', 'stream-2');   // finalizes stream-1
      mgr.onPondering('Gamma', 'stream-3');  // finalizes stream-2 (empty)
      mgr.onPondering('Delta', 'stream-4');  // finalizes stream-3 (empty)

      expect(mgr._activeStreamId).toBe('stream-4');
      expect(mgr._segments.size).toBe(1);

      // Old stream-1 HTTP connection finally sends more data — should be ignored
      mgr.onContent(' still alive', 'Old still alive', 'stream-1');
      // No event should reference seg_1 after its finalization
      const staleContentEvents = deps.events.filter(
        (e) => e.segmentId === 'seg_1' && e.final === false && e.text === 'Old still alive',
      );
      expect(staleContentEvents).toHaveLength(0);

      // Old stream-1 finally block fires — should not crash or call stopAck
      const ackBefore = deps.stopAckCalls;
      mgr.onPondering(null, 'stream-1');
      expect(deps.stopAckCalls).toBe(ackBefore); // no stopAck for stale stream

      // Stream 4 completes normally
      mgr.onPondering(null, 'stream-4');
      mgr.onContent('Final!', 'Final!', 'stream-4');
      mgr.onPondering(null, 'stream-4');

      const stream4Final = deps.events.find(
        (e) => e.final === true && e.segmentId === 'seg_4',
      );
      expect(stream4Final).toEqual({
        type: 'agent_transcript',
        segmentId: 'seg_4',
        delta: '',
        text: 'Final!',
        final: true,
      });
    });
  });

  // -------------------------------------------------------------------------
  // Segment ID incrementing
  // -------------------------------------------------------------------------
  describe('segment ID incrementing', () => {
    it('assigns monotonically increasing segment IDs', () => {
      mgr.onPondering('A', 'stream-1');
      mgr.onPondering('B', 'stream-2');
      mgr.onPondering('C', 'stream-3');

      expect(mgr._segments.get('stream-3')?.segId).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // Empty text segment — no final event emitted
  // -------------------------------------------------------------------------
  describe('empty text finalization', () => {
    it('does not emit final event when stream had no content text', () => {
      mgr.onPondering('Start', 'stream-1');
      // Stream interrupted before any content
      mgr.onPondering('Next', 'stream-2');

      // stream-1 was finalized but had empty text — no final event
      const finals = deps.events.filter((e) => e.final === true);
      expect(finals).toHaveLength(0);
    });
  });

  // =========================================================================
  // BUG-011: Zombie stream pondering storm
  // =========================================================================
  describe('BUG-011: zombie stream pondering rotation', () => {
    // -----------------------------------------------------------------------
    // 9. Pondering rotation on active stream — updates status, keeps segment
    // -----------------------------------------------------------------------
    it('publishes status but reuses segment for active stream rotation', () => {
      mgr.onPondering('Thinking...', 'stream-1');
      const segId = mgr._segments.get('stream-1')?.segId;
      expect(deps.statuses).toHaveLength(1);

      // Pondering rotation on same stream (3-second timer)
      mgr.onPondering('Still thinking...', 'stream-1');
      expect(deps.statuses).toHaveLength(2);
      expect(deps.statuses[1]).toEqual({ action: 'thinking', detail: 'Still thinking...' });

      // Segment is reused — NOT recreated
      expect(mgr._segments.size).toBe(1);
      expect(mgr._segments.get('stream-1')?.segId).toBe(segId);
      expect(mgr._activeStreamId).toBe('stream-1');
    });

    // -----------------------------------------------------------------------
    // 10. Zombie pondering after finalization — silently ignored
    // -----------------------------------------------------------------------
    it('ignores pondering rotation from a finalized zombie stream', () => {
      // Stream 1 starts and gets content
      mgr.onPondering('A', 'stream-1');
      mgr.onPondering(null, 'stream-1');
      mgr.onContent('Data', 'Data', 'stream-1');

      // Stream 2 starts — finalizes stream 1
      mgr.onPondering('B', 'stream-2');
      expect(mgr._activeStreamId).toBe('stream-2');
      const statusCountBefore = deps.statuses.length;

      // Stream 1 zombie rotates pondering (HTTP connection still open)
      mgr.onPondering('Zombie rotation', 'stream-1');

      // Active stream should NOT have changed
      expect(mgr._activeStreamId).toBe('stream-2');
      // No new status event published for zombie
      expect(deps.statuses).toHaveLength(statusCountBefore);
      // Only stream-2's segment exists
      expect(mgr._segments.size).toBe(1);
      expect(mgr._segments.has('stream-2')).toBe(true);
    });

    // -----------------------------------------------------------------------
    // 11. Zombie pondering storm — 6 concurrent zombie streams
    // -----------------------------------------------------------------------
    it('handles 6 concurrent zombie streams without segment ID explosion', () => {
      // Simulate a session with 6 turns — each creates a new stream
      mgr.onPondering('A', 's_1');
      mgr.onPondering(null, 's_1');
      mgr.onContent('R1', 'R1', 's_1');

      mgr.onPondering('B', 's_2');
      mgr.onPondering(null, 's_2');
      mgr.onContent('R2', 'R2', 's_2');

      mgr.onPondering('C', 's_3');
      mgr.onPondering(null, 's_3');
      mgr.onContent('R3', 'R3', 's_3');

      mgr.onPondering('D', 's_4');
      mgr.onPondering(null, 's_4');
      mgr.onContent('R4', 'R4', 's_4');

      mgr.onPondering('E', 's_5');
      mgr.onPondering(null, 's_5');
      mgr.onContent('R5', 'R5', 's_5');

      mgr.onPondering('F', 's_6');
      // s_6 is active, s_1-s_5 are finalized

      expect(mgr._activeStreamId).toBe('s_6');
      expect(mgr._segments.size).toBe(1);
      const segIdAfterSetup = mgr._segments.get('s_6')?.segId;
      expect(segIdAfterSetup).toBe(6);

      const statusCountBefore = deps.statuses.length;
      const eventCountBefore = deps.events.length;

      // ALL zombie streams rotate pondering simultaneously (the BUG-011 storm)
      mgr.onPondering('Zombie s_1', 's_1');
      mgr.onPondering('Zombie s_2', 's_2');
      mgr.onPondering('Zombie s_3', 's_3');
      mgr.onPondering('Zombie s_4', 's_4');
      mgr.onPondering('Zombie s_5', 's_5');

      // Active stream should NOT have changed
      expect(mgr._activeStreamId).toBe('s_6');
      // No new segments created
      expect(mgr._segments.size).toBe(1);
      // Segment ID should NOT have incremented
      expect(mgr._segments.get('s_6')?.segId).toBe(segIdAfterSetup);
      // No new status or transcript events from zombies
      expect(deps.statuses).toHaveLength(statusCountBefore);
      expect(deps.events).toHaveLength(eventCountBefore);

      // Active stream rotation DOES publish status
      mgr.onPondering('Active rotation', 's_6');
      expect(deps.statuses).toHaveLength(statusCountBefore + 1);
      expect(deps.statuses[deps.statuses.length - 1]).toEqual({
        action: 'thinking',
        detail: 'Active rotation',
      });

      // Active stream completes normally
      mgr.onPondering(null, 's_6');
      mgr.onContent('Final', 'Final', 's_6');
      mgr.onPondering(null, 's_6');

      const finalEvent = deps.events.find(
        (e) => e.final === true && e.segmentId === 'seg_6',
      );
      expect(finalEvent).toMatchObject({ text: 'Final', final: true });
    });

    // -----------------------------------------------------------------------
    // 12. Content from stale (non-active) stream with live segment — ignored
    // -----------------------------------------------------------------------
    it('ignores content from stale stream even if segment still exists', () => {
      // This can happen if a stream was created but not yet finalized
      // when a zombie delivers late content
      mgr.onPondering('A', 'stream-1');
      mgr.onPondering(null, 'stream-1');
      mgr.onContent('Data', 'Data', 'stream-1');

      // New stream — finalizes stream-1
      mgr.onPondering('B', 'stream-2');

      // stream-1 is finalized (segment deleted)
      // stream-2 is active with empty segment
      expect(mgr._activeStreamId).toBe('stream-2');

      // stream-2 gets content
      mgr.onContent('Good', 'Good', 'stream-2');

      const stream2Events = deps.events.filter(
        (e) => e.segmentId === 'seg_2' && e.final === false,
      );
      expect(stream2Events).toHaveLength(1);
      expect(stream2Events[0]).toMatchObject({ delta: 'Good', text: 'Good' });
    });

    // -----------------------------------------------------------------------
    // 13. Zombie stream finally block fires — no crash, no stopAck
    // -----------------------------------------------------------------------
    it('handles zombie finally blocks gracefully', () => {
      mgr.onPondering('A', 'stream-1');
      mgr.onPondering('B', 'stream-2');  // finalizes stream-1
      mgr.onPondering('C', 'stream-3');  // finalizes stream-2

      deps.stopAckCalls = 0;

      // All zombie finally blocks fire
      mgr.onPondering(null, 'stream-1');
      mgr.onPondering(null, 'stream-2');

      // No stopAck calls from zombies
      expect(deps.stopAckCalls).toBe(0);

      // Active stream's finally still works
      mgr.onPondering(null, 'stream-3');
      expect(deps.stopAckCalls).toBe(1);
    });

    // -----------------------------------------------------------------------
    // 14. knownStreamIds tracks all seen streams
    // -----------------------------------------------------------------------
    it('tracks all stream IDs in knownStreamIds', () => {
      mgr.onPondering('A', 'stream-1');
      mgr.onPondering('B', 'stream-2');
      mgr.onPondering('C', 'stream-3');

      // Interrupted streams stay in knownStreamIds until their finally block
      // fires — this preserves zombie protection (BUG-011).
      expect(mgr._knownStreamIds.has('stream-1')).toBe(true);
      expect(mgr._knownStreamIds.has('stream-2')).toBe(true);
      expect(mgr._knownStreamIds.has('stream-3')).toBe(true);
      expect(mgr._knownStreamIds.size).toBe(3);
    });

    // -----------------------------------------------------------------------
    // 14b. knownStreamIds shrinks after full stream lifecycle
    // -----------------------------------------------------------------------
    it('cleans up knownStreamIds after stream finalization', () => {
      // Full lifecycle: pondering → content → pondering-null → finalize
      mgr.onPondering('Thinking...', 'stream-1');
      expect(mgr._knownStreamIds.has('stream-1')).toBe(true);

      mgr.onPondering(null, 'stream-1');
      mgr.onContent('Hello', 'Hello', 'stream-1');
      mgr.onPondering(null, 'stream-1'); // finalizes

      // knownStreamIds should be cleaned up after finalization
      expect(mgr._knownStreamIds.has('stream-1')).toBe(false);
      expect(mgr._knownStreamIds.size).toBe(0);

      // A new stream with the same ID should be treated as new (not zombie)
      mgr.onPondering('New thought', 'stream-1');
      expect(mgr._knownStreamIds.has('stream-1')).toBe(true);
      expect(mgr._activeStreamId).toBe('stream-1');
      expect(mgr._segments.size).toBe(1);
    });

    // -----------------------------------------------------------------------
    // 15. Interleaved zombie rotations don't corrupt active content
    // -----------------------------------------------------------------------
    it('active stream content survives interleaved zombie rotations', () => {
      // Stream 1 starts, gets content, then stream 2 takes over
      mgr.onPondering('A', 'stream-1');
      mgr.onPondering(null, 'stream-1');
      mgr.onContent('Old', 'Old', 'stream-1');
      mgr.onPondering('B', 'stream-2');  // finalizes stream-1

      // Stream 2 is active, getting content
      mgr.onPondering(null, 'stream-2');
      mgr.onContent('Hello', 'Hello', 'stream-2');

      // Zombie stream-1 rotates in the middle of stream-2's content
      mgr.onPondering('Zombie!', 'stream-1');

      // Stream 2 should still be active and receiving content
      expect(mgr._activeStreamId).toBe('stream-2');
      mgr.onContent(' world', 'Hello world', 'stream-2');

      // Finalize stream 2
      mgr.onPondering(null, 'stream-2');

      const finalEvent = deps.events.find(
        (e) => e.final === true && e.segmentId === 'seg_2',
      );
      expect(finalEvent).toEqual({
        type: 'agent_transcript',
        segmentId: 'seg_2',
        delta: '',
        text: 'Hello world',
        final: true,
      });
    });
  });

  // =========================================================================
  // BUG-012: Late tool-call artifact stamping (lastFinalizedSegmentId)
  // =========================================================================
  describe('BUG-012: activeSegmentId after stream finalization', () => {
    // -----------------------------------------------------------------------
    // 16. activeSegmentId returns finalized segment ID after finalizeStream()
    // -----------------------------------------------------------------------
    it('returns finalized segment ID after stream finalization', () => {
      // Stream starts, receives content, and finalizes
      mgr.onPondering('Thinking...', 'stream-1');
      mgr.onPondering(null, 'stream-1'); // pre-content
      mgr.onContent('Hello', 'Hello', 'stream-1');

      // Before finalization, activeSegmentId returns the live segment
      expect(mgr.activeSegmentId).toBe('seg_1');

      // Finalize (second onPondering(null) with contentStarted=true)
      mgr.onPondering(null, 'stream-1');
      expect(mgr._segments.size).toBe(0);

      // After finalization, activeSegmentId should return the finalized ID
      // (not null), so late-arriving tool artifacts get stamped correctly
      expect(mgr.activeSegmentId).toBe('seg_1');
    });

    // -----------------------------------------------------------------------
    // 17. New stream's segment ID takes precedence over lastFinalizedSegmentId
    // -----------------------------------------------------------------------
    it('returns new stream segment ID when a new stream starts', () => {
      // Stream 1: full lifecycle
      mgr.onPondering('A', 'stream-1');
      mgr.onPondering(null, 'stream-1');
      mgr.onContent('R1', 'R1', 'stream-1');
      mgr.onPondering(null, 'stream-1'); // finalize

      expect(mgr.activeSegmentId).toBe('seg_1'); // lastFinalizedSegmentId

      // Stream 2 starts — activeSegmentId should switch to the new segment
      mgr.onPondering('B', 'stream-2');
      expect(mgr.activeSegmentId).toBe('seg_2');

      // lastFinalizedSegmentId should NOT leak through when a live segment exists
      mgr.onPondering(null, 'stream-2');
      mgr.onContent('R2', 'R2', 'stream-2');
      expect(mgr.activeSegmentId).toBe('seg_2');
    });

    // -----------------------------------------------------------------------
    // 18. After finalization, activeSegmentId returns lastFinalizedSegmentId
    //     (not null) — the core fix for late tool-call artifacts
    // -----------------------------------------------------------------------
    it('does not return null after finalization when lastFinalizedSegmentId is set', () => {
      // Stream 1
      mgr.onPondering('A', 'stream-1');
      mgr.onPondering(null, 'stream-1');
      mgr.onContent('Response', 'Response', 'stream-1');
      mgr.onPondering(null, 'stream-1'); // finalize

      // The segment is deleted, but activeSegmentId should still return
      // the finalized segment ID
      expect(mgr._segments.size).toBe(0);
      expect(mgr.activeSegmentId).not.toBeNull();
      expect(mgr.activeSegmentId).toBe('seg_1');
    });
  });
});
