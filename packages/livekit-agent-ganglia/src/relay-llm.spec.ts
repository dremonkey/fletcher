/**
 * RelayLLM unit tests.
 *
 * Tests the RelayLLM class and its integration with createGangliaFromEnv.
 *
 * Tests: T8, T15, T16
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { RelayLLM } from './relay-llm.js';
import { createGangliaFromEnv } from './factory.js';
import type { RelayRoom } from './ganglia-types.js';
import { llm } from '@livekit/agents';

// ---------------------------------------------------------------------------
// Mock Room helpers
// ---------------------------------------------------------------------------

interface MockRoom extends RelayRoom {
  /** Simulate a participant joining the room. */
  emitParticipantConnected(identity: string): void;
}

function makeMockRoom(remoteIdentities: string[] = []): MockRoom {
  const remoteParticipants = new Map<string, { identity: string }>(
    remoteIdentities.map((id) => [id, { identity: id }]),
  );

  const listeners = new Map<string, Array<(...args: any[]) => void>>();

  return {
    localParticipant: {
      async publishData() {},
    },

    remoteParticipants,

    on(event: string, listener: (...args: any[]) => void) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(listener);
      return this as any;
    },

    off(event: string, listener: (...args: any[]) => void) {
      const arr = listeners.get(event);
      if (arr) {
        const idx = arr.indexOf(listener);
        if (idx !== -1) arr.splice(idx, 1);
      }
      return this as any;
    },

    emitParticipantConnected(identity: string) {
      remoteParticipants.set(identity, { identity });
      const arr = listeners.get('participantConnected');
      if (arr) arr.forEach((fn) => fn({ identity }));
    },
  };
}

function makeChatCtx(text: string): llm.ChatContext {
  const ctx = new llm.ChatContext();
  (ctx as any).addMessage({ role: 'user', content: text });
  return ctx;
}

// ---------------------------------------------------------------------------
// T8: Relay participant presence — chat() waits or proceeds
// ---------------------------------------------------------------------------

describe('T8: RelayLLM.chat() — relay participant handling', () => {
  test('returns stream immediately when relay-* participant is present', () => {
    const room = makeMockRoom(['relay-main', 'mobile-alice']);
    const relayLlm = new RelayLLM({ room });

    const stream = relayLlm.chat({ chatCtx: makeChatCtx('Hello') });
    expect(stream).toBeTruthy();
    stream.close();
  });

  test('finds relay participant by relay- prefix', () => {
    const room = makeMockRoom(['relay-production-us-east']);
    const relayLlm = new RelayLLM({ room });

    const stream = relayLlm.chat({ chatCtx: makeChatCtx('Hi') });
    expect(stream).toBeTruthy();
    stream.close();
  });

  test('does not throw when no relay participant — returns stream that waits', () => {
    const room = makeMockRoom(['mobile-alice', 'voice-agent-1']);
    const relayLlm = new RelayLLM({ room });

    // Should NOT throw — creates a stream that will wait for relay
    const stream = relayLlm.chat({ chatCtx: makeChatCtx('Hello') });
    expect(stream).toBeTruthy();
    stream.close();
  });

  test('does not throw when room is empty — returns stream that waits', () => {
    const room = makeMockRoom([]);
    const relayLlm = new RelayLLM({ room });

    const stream = relayLlm.chat({ chatCtx: makeChatCtx('Hello') });
    expect(stream).toBeTruthy();
    stream.close();
  });

  test('waitForRelay resolves when relay joins after chat()', () => {
    const room = makeMockRoom([]);
    const relayLlm = new RelayLLM({ room });

    const stream = relayLlm.chat({ chatCtx: makeChatCtx('Hello') });
    expect(stream).toBeTruthy();

    // Simulate relay joining — the internal waitForRelay promise should resolve
    room.emitParticipantConnected('relay-zebes-rail');

    // Stream should have been unblocked (no timeout error)
    stream.close();
  });
});

// ---------------------------------------------------------------------------
// RelayLLM basic properties
// ---------------------------------------------------------------------------

describe('RelayLLM basic properties', () => {
  test('gangliaType() returns "relay"', () => {
    const room = makeMockRoom([]);
    const relayLlm = new RelayLLM({ room });
    expect(relayLlm.gangliaType()).toBe('relay');
  });

  test('label() returns "relay"', () => {
    const room = makeMockRoom([]);
    const relayLlm = new RelayLLM({ room });
    expect(relayLlm.label()).toBe('relay');
  });

  test('model returns "relay"', () => {
    const room = makeMockRoom([]);
    const relayLlm = new RelayLLM({ room });
    expect(relayLlm.model).toBe('relay');
  });

  test('aclose() is a no-op that resolves', async () => {
    const room = makeMockRoom([]);
    const relayLlm = new RelayLLM({ room });
    await expect(relayLlm.aclose()).resolves.toBeUndefined();
  });

  test('setSessionKey / getSessionKey round-trip', () => {
    const room = makeMockRoom([]);
    const relayLlm = new RelayLLM({ room });
    const key = { type: 'owner' as const, key: 'alice' };
    relayLlm.setSessionKey(key);
    expect(relayLlm.getSessionKey()).toEqual(key);
  });

  test('setDefaultSession does not throw', () => {
    const room = makeMockRoom([]);
    const relayLlm = new RelayLLM({ room });
    expect(() => relayLlm.setDefaultSession({ roomName: 'my-room' })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// T15: createGangliaFromEnv with GANGLIA_TYPE=relay
// ---------------------------------------------------------------------------

describe('T15: createGangliaFromEnv with GANGLIA_TYPE=relay', () => {
  const origGangliaType = process.env.GANGLIA_TYPE;

  afterEach(() => {
    if (origGangliaType !== undefined) {
      process.env.GANGLIA_TYPE = origGangliaType;
    } else {
      delete process.env.GANGLIA_TYPE;
    }
  });

  test('returns RelayLLM instance when GANGLIA_TYPE=relay and room provided', async () => {
    // Ensure the relay backend is registered
    await import('./relay-llm.js');

    process.env.GANGLIA_TYPE = 'relay';
    const room = makeMockRoom([]);

    const ganglia = await createGangliaFromEnv({ room });

    expect(ganglia).toBeInstanceOf(RelayLLM);
    expect(ganglia.gangliaType()).toBe('relay');
  });
});

// ---------------------------------------------------------------------------
// T16: createGangliaFromEnv with type=relay but no room
// ---------------------------------------------------------------------------

describe('T16: createGangliaFromEnv with type=relay but no room', () => {
  const origGangliaType = process.env.GANGLIA_TYPE;

  afterEach(() => {
    if (origGangliaType !== undefined) {
      process.env.GANGLIA_TYPE = origGangliaType;
    } else {
      delete process.env.GANGLIA_TYPE;
    }
  });

  test('throws when GANGLIA_TYPE=relay and no room provided', async () => {
    await import('./relay-llm.js');

    process.env.GANGLIA_TYPE = 'relay';

    await expect(createGangliaFromEnv()).rejects.toThrow(
      /GANGLIA_TYPE=relay requires a room/,
    );
  });

  test('throws when GANGLIA_TYPE=relay and room is undefined', async () => {
    await import('./relay-llm.js');

    process.env.GANGLIA_TYPE = 'relay';

    await expect(createGangliaFromEnv({ room: undefined })).rejects.toThrow(
      /GANGLIA_TYPE=relay requires a room/,
    );
  });
});
