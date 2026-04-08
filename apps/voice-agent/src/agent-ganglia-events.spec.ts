/**
 * Tests for the ganglia-events data channel handler in agent.ts.
 *
 * These tests verify the set of events the voice agent accepts on the
 * 'ganglia-events' topic.  Rather than importing agent.ts directly (which
 * runs CLI startup code at module load), they inspect the source text — the
 * same technique used in agent-env.spec.ts.
 *
 * Background: T30.03 removed the 'text_message' handler because mobile now
 * routes typed text through the relay (session/prompt) in both modes.
 * The remaining handlers — tts-mode and end_voice_session — are voice-agent
 * control events that must be preserved.
 */
import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

// Read the agent source once for all assertions.
const agentSource = readFileSync(join(import.meta.dir, 'agent.ts'), 'utf8');

// Narrow the inspection to the ganglia-events handler block so we don't
// accidentally match references outside that scope.  The block starts at
// the DataReceived listener and ends at the closing `}` of the callback.
// We identify it by the topic guard and capture everything up to the catch.
const gangliaHandlerMatch = agentSource.match(
  /if \(topic !== "ganglia-events"\) return;[\s\S]*?} catch \(e\)/,
);
const gangliaHandler = gangliaHandlerMatch?.[0] ?? '';

describe('ganglia-events handler (T30.03)', () => {
  it('text_message is no longer handled on ganglia-events', () => {
    // Mobile now sends typed text via session/prompt on the relay topic.
    // The voice agent must not process text_message events — verify by
    // checking the handler code does not branch on that event type.
    expect(gangliaHandler).not.toContain('event.type === "text_message"');
    expect(gangliaHandler).not.toContain("event.type === 'text_message'");
    expect(gangliaHandler).not.toContain('generateReply');
  });

  it('tts-mode control event is still handled', () => {
    // Voice agent must honour tts-mode to enable/disable audio output.
    expect(gangliaHandler).toContain('tts-mode');
    expect(gangliaHandler).toContain('setAudioEnabled');
  });

  it('end_voice_session control event is still handled', () => {
    // Voice agent must self-terminate when the client switches to text mode.
    expect(gangliaHandler).toContain('end_voice_session');
    expect(gangliaHandler).toContain('ctx.room.disconnect');
  });

  it('ganglia-events handler block was found (sanity check)', () => {
    // If this fails, the regex above no longer matches — update the regex.
    expect(gangliaHandler.length).toBeGreaterThan(50);
  });
});
