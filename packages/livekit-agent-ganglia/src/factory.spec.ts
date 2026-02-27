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
  it('openclaw backend is registered after import', async () => {
    // Import the llm module to trigger registration
    await import('./llm.js');
    expect(isGangliaAvailable('openclaw')).toBe(true);
  });

  it('nanoclaw backend is registered after import', async () => {
    // Import the nanoclaw module to trigger registration
    await import('./nanoclaw.js');
    expect(isGangliaAvailable('nanoclaw')).toBe(true);
  });

  it('both backends are available via index', async () => {
    // Import from index to ensure both are loaded
    const ganglia = await import('./index.js');

    expect(ganglia.isGangliaAvailable('openclaw')).toBe(true);
    expect(ganglia.isGangliaAvailable('nanoclaw')).toBe(true);
    expect(ganglia.getRegisteredTypes()).toContain('openclaw');
    expect(ganglia.getRegisteredTypes()).toContain('nanoclaw');
  });

  it('createGanglia works for openclaw', async () => {
    await import('./llm.js');
    const llm = await createGanglia({
      type: 'openclaw',
      openclaw: {
        baseUrl: 'http://localhost:8080',
        apiKey: 'test-token',
      },
    });

    expect(llm.gangliaType()).toBe('openclaw');
    expect(llm.label()).toBe('openclaw');
  });

  it('createGanglia works for nanoclaw', async () => {
    await import('./nanoclaw.js');
    const llm = await createGanglia({
      type: 'nanoclaw',
      nanoclaw: {
        url: 'http://localhost:18789',
      },
    });

    expect(llm.gangliaType()).toBe('nanoclaw');
    expect(llm.label()).toBe('nanoclaw');
  });
});
