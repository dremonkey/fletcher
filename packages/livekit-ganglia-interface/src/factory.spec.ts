import { describe, it, expect, beforeEach } from 'bun:test';
import {
  registerGanglia,
  getRegisteredTypes,
  isGangliaAvailable,
  createGanglia,
  type GangliaLLM,
} from './factory.js';
import type { GangliaSessionInfo } from './types.js';

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
