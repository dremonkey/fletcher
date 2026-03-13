/**
 * Relay transport abstraction.
 *
 * Separates RelayChatStream orchestration (pondering, ChatChunk, onContent)
 * from the underlying message delivery mechanism. DataChannelTransport is the
 * production implementation; the interface allows swapping in test mocks or
 * alternative transports (WebSocket, HTTP SSE, etc.) without touching stream
 * logic.
 */

import type { RelayRoom } from './ganglia-types.js';
import { dbg } from './logger.js';

/** LiveKit RoomEvent name for data received. */
const DATA_RECEIVED_EVENT = 'dataReceived';

/** Topic used for voice-agent ↔ relay ACP messages. */
export const VOICE_ACP_TOPIC = 'voice-acp';

// ---------------------------------------------------------------------------
// StreamTransport interface
// ---------------------------------------------------------------------------

/**
 * Pluggable transport for relay LLM communication.
 *
 * Implementations must handle JSON serialization/deserialization. Callers
 * pass plain objects; the transport is responsible for encoding.
 */
export interface StreamTransport {
  /** Serialize and publish a JSON-RPC request to the relay. */
  sendRequest(request: object): void;

  /**
   * Subscribe to incoming messages from the relay.
   * @returns An unsubscribe function — call it to stop receiving messages.
   */
  onMessage(handler: (msg: unknown) => void): () => void;

  /** Publish a cancel notification to the relay. */
  sendCancel(requestId: string): void;
}

// ---------------------------------------------------------------------------
// DataChannelTransport
// ---------------------------------------------------------------------------

/**
 * StreamTransport implementation that uses LiveKit data channels.
 *
 * - Send: `room.localParticipant.publishData()` on the `voice-acp` topic
 * - Receive: `room.on(DataReceived)` filtered to the `voice-acp` topic
 *
 * Message encoding: UTF-8 JSON (Uint8Array ↔ string).
 */
export class DataChannelTransport implements StreamTransport {
  private readonly _room: RelayRoom;
  private readonly _topic: string;

  constructor(room: RelayRoom, topic: string = VOICE_ACP_TOPIC) {
    this._room = room;
    this._topic = topic;
  }

  /**
   * Serialize `request` to JSON and publish on the configured topic.
   * Fire-and-forget — publish errors are logged but not re-thrown.
   */
  sendRequest(request: object): void {
    const json = JSON.stringify(request);
    dbg.relayClient('→ relay [%s]: %s', this._topic, json);
    const encoded = new TextEncoder().encode(json);
    this._room.localParticipant
      .publishData(encoded, { topic: this._topic, reliable: true })
      .catch((err: unknown) => {
        dbg.relayClient('publishData error (sendRequest): %s', (err as Error).message);
      });
  }

  /**
   * Subscribe to incoming messages on the voice-acp topic.
   *
   * The LiveKit DataReceived event signature is:
   *   (payload: Uint8Array, participant: RemoteParticipant | undefined, kind: DataPacketKind, topic: string | undefined)
   *
   * Returns an unsubscribe function.
   */
  onMessage(handler: (msg: unknown) => void): () => void {
    const listener = (
      payload: Uint8Array,
      _participant: unknown,
      _kind: unknown,
      topic: string | undefined,
    ) => {
      if (topic !== this._topic) {
        dbg.relayClient('← relay: ignoring topic=%s (want %s)', topic, this._topic);
        return;
      }

      let msg: unknown;
      try {
        const json = new TextDecoder().decode(payload);
        dbg.relayClient('← relay [%s]: %s', this._topic, json);
        msg = JSON.parse(json);
      } catch (err) {
        dbg.relayClient('relay: failed to parse message: %s', (err as Error).message);
        return;
      }

      handler(msg);
    };

    this._room.on(DATA_RECEIVED_EVENT, listener);

    return () => {
      this._room.off(DATA_RECEIVED_EVENT, listener);
    };
  }

  /**
   * Publish a JSON-RPC cancel notification on the voice-acp topic.
   * Fire-and-forget — publish errors are logged but not re-thrown.
   */
  sendCancel(_requestId: string): void {
    const cancel = {
      jsonrpc: '2.0',
      method: 'session/cancel',
      params: {},
    };
    const json = JSON.stringify(cancel);
    dbg.relayClient('→ relay [%s] cancel: %s', this._topic, json);
    const encoded = new TextEncoder().encode(json);
    this._room.localParticipant
      .publishData(encoded, { topic: this._topic, reliable: true })
      .catch((err: unknown) => {
        dbg.relayClient('publishData error (sendCancel): %s', (err as Error).message);
      });
  }
}
