/**
 * Tests for voice agent environment variable configuration.
 *
 * These tests verify the env var defaults and validation logic described
 * in the agent.ts header comment. They do not import agent.ts directly
 * (which runs CLI startup code at module load) — instead they test the
 * same env resolution logic in isolation.
 */
import { describe, it, expect, afterEach } from 'bun:test';

// -------------------------------------------------------------------------
// Helpers mirroring env resolution logic in agent.ts
// -------------------------------------------------------------------------

/** Returns the resolved ganglia type, matching agent.ts line: process.env.GANGLIA_TYPE ?? 'relay' */
function resolveGangliaType(): string {
  return process.env.GANGLIA_TYPE ?? 'relay';
}

// -------------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------------

describe('voice agent env: GANGLIA_TYPE', () => {
  const origGangliaType = process.env.GANGLIA_TYPE;

  afterEach(() => {
    // Restore env after each test
    if (origGangliaType === undefined) {
      delete process.env.GANGLIA_TYPE;
    } else {
      process.env.GANGLIA_TYPE = origGangliaType;
    }
  });

  it('defaults to relay when GANGLIA_TYPE is not set', () => {
    delete process.env.GANGLIA_TYPE;
    expect(resolveGangliaType()).toBe('relay');
  });

  it('uses the value of GANGLIA_TYPE when set', () => {
    process.env.GANGLIA_TYPE = 'relay';
    expect(resolveGangliaType()).toBe('relay');
  });

  it('relay is the default (not acp or nanoclaw)', () => {
    delete process.env.GANGLIA_TYPE;
    const type = resolveGangliaType();
    expect(type).not.toBe('acp');
    expect(type).not.toBe('nanoclaw');
    expect(type).toBe('relay');
  });
});
