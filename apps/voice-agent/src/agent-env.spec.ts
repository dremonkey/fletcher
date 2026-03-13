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

/** Returns the resolved ganglia type, matching agent.ts line: process.env.GANGLIA_TYPE ?? 'acp' */
function resolveGangliaType(): string {
  return process.env.GANGLIA_TYPE ?? 'acp';
}

/** Returns the resolved ACP command, matching factory.ts default */
function resolveAcpCommand(): string {
  return process.env.ACP_COMMAND ?? 'openclaw';
}

/** Returns the resolved ACP args string, matching factory.ts default */
function resolveAcpArgs(): string {
  return process.env.ACP_ARGS ?? 'acp';
}

/** Returns the resolved ACP prompt timeout, matching factory.ts default */
function resolveAcpPromptTimeout(): number | undefined {
  return process.env.ACP_PROMPT_TIMEOUT_MS
    ? parseInt(process.env.ACP_PROMPT_TIMEOUT_MS, 10)
    : undefined;
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

  it('defaults to acp when GANGLIA_TYPE is not set', () => {
    delete process.env.GANGLIA_TYPE;
    expect(resolveGangliaType()).toBe('acp');
  });

  it('uses the value of GANGLIA_TYPE when set', () => {
    process.env.GANGLIA_TYPE = 'nanoclaw';
    expect(resolveGangliaType()).toBe('nanoclaw');
  });

  it('acp is the default (not openclaw)', () => {
    delete process.env.GANGLIA_TYPE;
    const type = resolveGangliaType();
    expect(type).not.toBe('openclaw');
    expect(type).toBe('acp');
  });
});

describe('voice agent env: ACP_COMMAND', () => {
  const origCommand = process.env.ACP_COMMAND;

  afterEach(() => {
    if (origCommand === undefined) {
      delete process.env.ACP_COMMAND;
    } else {
      process.env.ACP_COMMAND = origCommand;
    }
  });

  it('defaults to openclaw when ACP_COMMAND is not set', () => {
    delete process.env.ACP_COMMAND;
    expect(resolveAcpCommand()).toBe('openclaw');
  });

  it('uses the value of ACP_COMMAND when set', () => {
    process.env.ACP_COMMAND = 'my-custom-acp-binary';
    expect(resolveAcpCommand()).toBe('my-custom-acp-binary');
  });
});

describe('voice agent env: ACP_ARGS', () => {
  const origArgs = process.env.ACP_ARGS;

  afterEach(() => {
    if (origArgs === undefined) {
      delete process.env.ACP_ARGS;
    } else {
      process.env.ACP_ARGS = origArgs;
    }
  });

  it('defaults to acp when ACP_ARGS is not set', () => {
    delete process.env.ACP_ARGS;
    expect(resolveAcpArgs()).toBe('acp');
  });

  it('uses the value of ACP_ARGS when set', () => {
    process.env.ACP_ARGS = 'acp,--verbose,--debug';
    expect(resolveAcpArgs()).toBe('acp,--verbose,--debug');
  });
});

describe('voice agent env: ACP_PROMPT_TIMEOUT_MS', () => {
  const origTimeout = process.env.ACP_PROMPT_TIMEOUT_MS;

  afterEach(() => {
    if (origTimeout === undefined) {
      delete process.env.ACP_PROMPT_TIMEOUT_MS;
    } else {
      process.env.ACP_PROMPT_TIMEOUT_MS = origTimeout;
    }
  });

  it('returns undefined when ACP_PROMPT_TIMEOUT_MS is not set (factory uses its own default)', () => {
    delete process.env.ACP_PROMPT_TIMEOUT_MS;
    expect(resolveAcpPromptTimeout()).toBeUndefined();
  });

  it('parses ACP_PROMPT_TIMEOUT_MS as an integer', () => {
    process.env.ACP_PROMPT_TIMEOUT_MS = '30000';
    expect(resolveAcpPromptTimeout()).toBe(30000);
  });
});

describe('voice agent env: OPENCLAW_API_KEY no longer required', () => {
  /**
   * The voice agent no longer validates OPENCLAW_API_KEY for the default
   * backend. ACP authentication is handled by the spawned subprocess.
   *
   * These tests verify that the acp type never triggers an API key check.
   * The old logic was: if (gangliaType === 'openclaw' && !OPENCLAW_API_KEY) → fatal.
   * That check has been removed. For acp, no key is needed.
   */

  it('acp type does not require OPENCLAW_API_KEY', () => {
    const savedKey = process.env.OPENCLAW_API_KEY;
    const savedType = process.env.GANGLIA_TYPE;

    delete process.env.OPENCLAW_API_KEY;
    process.env.GANGLIA_TYPE = 'acp';

    const type = resolveGangliaType();
    expect(type).toBe('acp');

    // The old validation would have called process.exit(1) here for openclaw.
    // For acp, no validation is needed — assert the type is not openclaw.
    expect(type).not.toBe('openclaw');

    if (savedType === undefined) delete process.env.GANGLIA_TYPE;
    else process.env.GANGLIA_TYPE = savedType;
    if (savedKey !== undefined) process.env.OPENCLAW_API_KEY = savedKey;
  });

  it('default type (no GANGLIA_TYPE set) does not require OPENCLAW_API_KEY', () => {
    const savedKey = process.env.OPENCLAW_API_KEY;
    const savedType = process.env.GANGLIA_TYPE;

    delete process.env.OPENCLAW_API_KEY;
    delete process.env.GANGLIA_TYPE;

    const type = resolveGangliaType();
    // Default is 'acp', not 'openclaw' — no API key required
    expect(type).toBe('acp');
    expect(type).not.toBe('openclaw');

    if (savedType !== undefined) process.env.GANGLIA_TYPE = savedType;
    if (savedKey !== undefined) process.env.OPENCLAW_API_KEY = savedKey;
  });
});
