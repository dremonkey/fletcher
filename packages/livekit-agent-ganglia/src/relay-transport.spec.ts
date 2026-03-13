/**
 * DataChannelTransport unit tests.
 *
 * Tests the transport layer that bridges RelayChatStream to the LiveKit
 * data channel. Uses a minimal mock Room that captures published data.
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { DataChannelTransport, VOICE_ACP_TOPIC } from './relay-transport.js';
import type { RelayRoom } from './ganglia-types.js';

// ---------------------------------------------------------------------------
// Mock Room
// ---------------------------------------------------------------------------

interface PublishedMessage {
  data: Uint8Array;
  opts?: { topic?: string; reliable?: boolean };
}

function makeMockRoom(): RelayRoom & {
  publishedMessages: PublishedMessage[];
  listeners: Map<string, Array<(...args: any[]) => void>>;
  emitData(payload: Uint8Array, topic: string): void;
} {
  const publishedMessages: PublishedMessage[] = [];
  const listeners = new Map<string, Array<(...args: any[]) => void>>();

  const room: RelayRoom & {
    publishedMessages: PublishedMessage[];
    listeners: Map<string, Array<(...args: any[]) => void>>;
    emitData(payload: Uint8Array, topic: string): void;
  } = {
    publishedMessages,
    listeners,

    localParticipant: {
      async publishData(data: Uint8Array, opts?: { topic?: string; reliable?: boolean }) {
        publishedMessages.push({ data, opts });
      },
    },

    remoteParticipants: new Map(),

    on(event: string, listener: (...args: any[]) => void) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(listener);
      return room as any;
    },

    off(event: string, listener: (...args: any[]) => void) {
      const arr = listeners.get(event);
      if (arr) {
        const idx = arr.indexOf(listener);
        if (idx !== -1) arr.splice(idx, 1);
      }
      return room as any;
    },

    emitData(payload: Uint8Array, topic: string) {
      const arr = listeners.get('dataReceived');
      if (arr) {
        for (const fn of arr) {
          fn(payload, undefined, undefined, topic);
        }
      }
    },
  };

  return room;
}

function decodePublished(msg: PublishedMessage): unknown {
  return JSON.parse(new TextDecoder().decode(msg.data));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DataChannelTransport', () => {
  let room: ReturnType<typeof makeMockRoom>;
  let transport: DataChannelTransport;

  beforeEach(() => {
    room = makeMockRoom();
    transport = new DataChannelTransport(room, VOICE_ACP_TOPIC);
  });

  // ---- sendRequest ----

  test('sendRequest publishes JSON on the voice-acp topic', async () => {
    const request = { jsonrpc: '2.0', id: 'req-1', method: 'session/prompt', params: {} };
    transport.sendRequest(request);

    // publishData is fire-and-forget (async), wait a tick
    await new Promise((r) => setTimeout(r, 0));

    expect(room.publishedMessages.length).toBe(1);
    const msg = room.publishedMessages[0];
    expect(msg.opts?.topic).toBe(VOICE_ACP_TOPIC);
    expect(msg.opts?.reliable).toBe(true);
    expect(decodePublished(msg)).toEqual(request);
  });

  // ---- onMessage ----

  test('onMessage receives messages on voice-acp topic', () => {
    const received: unknown[] = [];
    transport.onMessage((msg) => received.push(msg));

    const payload = new TextEncoder().encode(
      JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: {} }),
    );
    room.emitData(payload, VOICE_ACP_TOPIC);

    expect(received.length).toBe(1);
    expect((received[0] as any).method).toBe('session/update');
  });

  test('onMessage ignores messages on other topics', () => {
    const received: unknown[] = [];
    transport.onMessage((msg) => received.push(msg));

    const payload = new TextEncoder().encode(JSON.stringify({ foo: 'bar' }));
    room.emitData(payload, 'relay'); // different topic

    expect(received.length).toBe(0);
  });

  test('onMessage unsubscribe stops message delivery', () => {
    const received: unknown[] = [];
    const unsubscribe = transport.onMessage((msg) => received.push(msg));

    const payload = new TextEncoder().encode(JSON.stringify({ jsonrpc: '2.0', id: '1' }));

    room.emitData(payload, VOICE_ACP_TOPIC);
    expect(received.length).toBe(1);

    unsubscribe();
    room.emitData(payload, VOICE_ACP_TOPIC);
    expect(received.length).toBe(1); // still 1 — no new messages
  });

  test('onMessage ignores malformed JSON gracefully', () => {
    const received: unknown[] = [];
    transport.onMessage((msg) => received.push(msg));

    const bad = new TextEncoder().encode('not json {{{{');
    room.emitData(bad, VOICE_ACP_TOPIC);

    expect(received.length).toBe(0);
  });

  // ---- sendCancel ----

  test('sendCancel publishes session/cancel on voice-acp topic', async () => {
    transport.sendCancel('req-1');

    await new Promise((r) => setTimeout(r, 0));

    expect(room.publishedMessages.length).toBe(1);
    const msg = room.publishedMessages[0];
    expect(msg.opts?.topic).toBe(VOICE_ACP_TOPIC);
    const decoded = decodePublished(msg) as any;
    expect(decoded.method).toBe('session/cancel');
    expect(decoded.jsonrpc).toBe('2.0');
  });
});
