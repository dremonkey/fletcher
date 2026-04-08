import { describe, it, expect, beforeEach } from 'bun:test';
import {
  registerGanglia,
  getRegisteredTypes,
  isGangliaAvailable,
  createGanglia,
  type GangliaLLM,
} from './factory.js';
import type { GangliaSessionInfo } from './ganglia-types.js';

// Mock LLM class for testing
class MockLLM implements Partial<GangliaLLM> {
  config: any;

  constructor(config: any) {
    this.config = config;
  }

  gangliaType(): string {
    return 'mock';
  }

  setDefaultSession(_session: GangliaSessionInfo): void {
    // no-op
  }

  label(): string {
    return 'mock';
  }

  get model(): string {
    return 'mock-model';
  }
}

describe('registerGanglia', () => {
  it('registers a ganglia implementation', async () => {
    registerGanglia('mock', async () => MockLLM as any);

    expect(isGangliaAvailable('mock')).toBe(true);
    expect(getRegisteredTypes()).toContain('mock');
  });
});

describe('createGanglia', () => {
  beforeEach(() => {
    // Register mock for testing
    registerGanglia('mock', async () => MockLLM as any);
  });

  it('throws for unknown type', async () => {
    await expect(
      createGanglia({ type: 'unknown' as any, unknown: {} } as any),
    ).rejects.toThrow('Unknown ganglia type: unknown');
  });
});

describe('getRegisteredTypes', () => {
  it('returns list of registered types', () => {
    registerGanglia('test1', async () => MockLLM as any);
    registerGanglia('test2', async () => MockLLM as any);

    const types = getRegisteredTypes();
    expect(types).toContain('test1');
    expect(types).toContain('test2');
  });
});

describe('isGangliaAvailable', () => {
  it('returns true for registered type', () => {
    registerGanglia('available', async () => MockLLM as any);
    expect(isGangliaAvailable('available')).toBe(true);
  });

  it('returns false for unregistered type', () => {
    expect(isGangliaAvailable('notregistered')).toBe(false);
  });
});

describe('Backend Registration', () => {
  it('relay backend is registered after import', async () => {
    await import('./relay-llm.js');
    expect(isGangliaAvailable('relay')).toBe(true);
  });

  it('relay is available via index', async () => {
    const ganglia = await import('./index.js');

    expect(ganglia.isGangliaAvailable('relay')).toBe(true);
    expect(ganglia.getRegisteredTypes()).toContain('relay');
  });

  it('nanoclaw is no longer available', async () => {
    await import('./index.js');
    expect(isGangliaAvailable('nanoclaw')).toBe(false);
  });

  it('acp type is not available', async () => {
    await import('./index.js');
    expect(isGangliaAvailable('acp')).toBe(false);
  });

  it('createGanglia works for relay', async () => {
    await import('./relay-llm.js');
    const mockRoom = {
      localParticipant: { publishData: async () => {} },
      remoteParticipants: new Map(),
      on: () => ({} as any),
      off: () => ({} as any),
    };
    const llm = await createGanglia({
      type: 'relay',
      relay: { room: mockRoom as any },
    });

    expect(llm.gangliaType()).toBe('relay');
    expect(llm.label()).toBe('relay');
  });
});

describe('createGangliaFromEnv', () => {
  it('defaults to relay when GANGLIA_TYPE not set', async () => {
    await import('./relay-llm.js');
    const origType = process.env.GANGLIA_TYPE;
    delete process.env.GANGLIA_TYPE;

    const { createGangliaFromEnv } = await import('./factory.js');

    // relay requires a room — should throw a clear error
    await expect(createGangliaFromEnv()).rejects.toThrow(
      'GANGLIA_TYPE=relay requires a room',
    );

    // Restore env
    if (origType !== undefined) process.env.GANGLIA_TYPE = origType;
  });

  it('throws for unknown GANGLIA_TYPE', async () => {
    await import('./index.js');
    const origType = process.env.GANGLIA_TYPE;
    process.env.GANGLIA_TYPE = 'unknown-backend';

    const { createGangliaFromEnv } = await import('./factory.js');
    await expect(createGangliaFromEnv()).rejects.toThrow('Unknown GANGLIA_TYPE: unknown-backend');

    if (origType !== undefined) process.env.GANGLIA_TYPE = origType;
    else delete process.env.GANGLIA_TYPE;
  });
});
