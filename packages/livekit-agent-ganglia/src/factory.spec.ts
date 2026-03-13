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
  it('acp backend is registered after import', async () => {
    // Import the acp-llm module to trigger registration
    await import('./acp-llm.js');
    expect(isGangliaAvailable('acp')).toBe(true);
  });

  it('nanoclaw backend is registered after import', async () => {
    // Import the nanoclaw module to trigger registration
    await import('./nanoclaw.js');
    expect(isGangliaAvailable('nanoclaw')).toBe(true);
  });

  it('both backends are available via index', async () => {
    // Import from index to ensure both are loaded
    const ganglia = await import('./index.js');

    expect(ganglia.isGangliaAvailable('acp')).toBe(true);
    expect(ganglia.isGangliaAvailable('nanoclaw')).toBe(true);
    expect(ganglia.getRegisteredTypes()).toContain('acp');
    expect(ganglia.getRegisteredTypes()).toContain('nanoclaw');
  });

  it('openclaw type is no longer available', async () => {
    await import('./index.js');
    expect(isGangliaAvailable('openclaw')).toBe(false);
  });

  it('createGanglia works for acp', async () => {
    await import('./acp-llm.js');
    const llm = await createGanglia({
      type: 'acp',
      acp: {
        command: 'bun',
        args: ['--version'],
      },
    });

    expect(llm.gangliaType()).toBe('acp');
    expect(llm.label()).toBe('acp');
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

  it('createGanglia throws Unknown ganglia type for openclaw', async () => {
    await expect(
      createGanglia({ type: 'openclaw' as any, openclaw: {} } as any),
    ).rejects.toThrow('Unknown ganglia type: openclaw');
  });
});

describe('createGangliaFromEnv', () => {
  it('defaults to acp when GANGLIA_TYPE not set', async () => {
    await import('./acp-llm.js');
    const origType = process.env.GANGLIA_TYPE;
    const origBrainType = process.env.BRAIN_TYPE;
    delete process.env.GANGLIA_TYPE;
    delete process.env.BRAIN_TYPE;

    const { createGangliaFromEnv } = await import('./factory.js');
    const llm = await createGangliaFromEnv();

    expect(llm.gangliaType()).toBe('acp');

    // Restore env
    if (origType !== undefined) process.env.GANGLIA_TYPE = origType;
    if (origBrainType !== undefined) process.env.BRAIN_TYPE = origBrainType;
  });

  it('creates acp when GANGLIA_TYPE=acp', async () => {
    await import('./acp-llm.js');
    const origType = process.env.GANGLIA_TYPE;
    process.env.GANGLIA_TYPE = 'acp';

    const { createGangliaFromEnv } = await import('./factory.js');
    const llm = await createGangliaFromEnv();

    expect(llm.gangliaType()).toBe('acp');

    if (origType !== undefined) process.env.GANGLIA_TYPE = origType;
    else delete process.env.GANGLIA_TYPE;
  });

  it('creates nanoclaw when GANGLIA_TYPE=nanoclaw', async () => {
    await import('./nanoclaw.js');
    const origType = process.env.GANGLIA_TYPE;
    process.env.GANGLIA_TYPE = 'nanoclaw';

    const { createGangliaFromEnv } = await import('./factory.js');
    const llm = await createGangliaFromEnv();

    expect(llm.gangliaType()).toBe('nanoclaw');

    if (origType !== undefined) process.env.GANGLIA_TYPE = origType;
    else delete process.env.GANGLIA_TYPE;
  });

  it('throws for GANGLIA_TYPE=openclaw', async () => {
    await import('./index.js');
    const origType = process.env.GANGLIA_TYPE;
    process.env.GANGLIA_TYPE = 'openclaw';

    const { createGangliaFromEnv } = await import('./factory.js');
    await expect(createGangliaFromEnv()).rejects.toThrow('Unknown GANGLIA_TYPE: openclaw');

    if (origType !== undefined) process.env.GANGLIA_TYPE = origType;
    else delete process.env.GANGLIA_TYPE;
  });
});
