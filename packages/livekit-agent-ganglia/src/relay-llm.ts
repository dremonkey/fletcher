/**
 * RelayLLM — LiveKit LLM backend that routes requests through the relay
 * participant via the LiveKit data channel.
 *
 * When GANGLIA_TYPE=relay, the voice-agent sends session/prompt requests
 * over the voice-acp topic to a relay-* participant, which forwards them to
 * an ACP subprocess. This avoids spawning a local ACP subprocess from the
 * voice-agent container.
 */
import { llm, APIConnectOptions } from '@livekit/agents';
import { type GangliaLLM, registerGanglia } from './factory.js';
import type { GangliaSessionInfo, RelayConfig, RelayRoom } from './ganglia-types.js';
import type { SessionKey } from './session-routing.js';
import { type Logger, noopLogger, dbg } from './logger.js';
import { DataChannelTransport, VOICE_ACP_TOPIC } from './relay-transport.js';
import { RelayChatStream } from './relay-stream.js';

type ChatContext = llm.ChatContext;
type ToolContext = llm.ToolContext;
type ToolChoice = llm.ToolChoice;

const LLMBase = llm.LLM;

/** Default prompt timeout: 2 minutes. */
const DEFAULT_PROMPT_TIMEOUT_MS = 120_000;

/** How long to wait for a relay-* participant before giving up (ms). */
const RELAY_WAIT_TIMEOUT_MS = 10_000;

export class RelayLLM extends LLMBase implements GangliaLLM {
  private readonly _config: RelayConfig;
  private readonly _logger: Logger;
  private _sessionKey?: SessionKey;
  private _defaultSession?: GangliaSessionInfo;
  private _onPondering?: (phrase: string | null, streamId: string) => void;
  private _onContent?: (delta: string, fullText: string, streamId: string) => void;
  private readonly _promptTimeoutMs: number;
  private _nextStreamSeq = 0;

  constructor(config: RelayConfig) {
    super();
    this._config = config;
    this._logger = config.logger ?? noopLogger;
    this._onPondering = config.onPondering;
    this._onContent = config.onContent;
    this._promptTimeoutMs = config.promptTimeoutMs ?? DEFAULT_PROMPT_TIMEOUT_MS;

    // Guard against duplicate @livekit/agents installs.
    if (!(this instanceof LLMBase)) {
      const msg = [
        'RelayLLM: instanceof LLM check failed — likely duplicate @livekit/agents installs.',
        'Ensure @livekit/agents is a peerDependency (not a direct dependency) in livekit-agent-ganglia.',
        'Run: bun why @livekit/agents',
      ].join(' ');
      dbg.relayStream(msg);
      throw new Error(msg);
    }
  }

  /**
   * Returns the ganglia type identifier.
   */
  gangliaType(): string {
    return 'relay';
  }

  label(): string {
    return 'relay';
  }

  get model(): string {
    return 'relay';
  }

  /**
   * Sets the default session metadata for all subsequent chat requests.
   */
  setDefaultSession(session: GangliaSessionInfo): void {
    this._defaultSession = session;
  }

  /**
   * Sets the session key for routing.
   */
  setSessionKey(sessionKey: SessionKey): void {
    this._sessionKey = sessionKey;
  }

  /**
   * Returns the current session key, if set.
   */
  getSessionKey(): SessionKey | undefined {
    return this._sessionKey;
  }

  /**
   * Creates a new chat stream for a user turn.
   *
   * If no relay-* participant is currently in the room, the stream will wait
   * up to RELAY_WAIT_TIMEOUT_MS for one to appear before sending the request.
   * This handles the bootstrap race where the agent joins before the relay.
   */
  chat({
    chatCtx,
    toolCtx,
    connOptions,
  }: {
    chatCtx: ChatContext;
    toolCtx?: ToolContext;
    connOptions?: APIConnectOptions;
    parallelToolCalls?: boolean;
    toolChoice?: ToolChoice;
    extraKwargs?: Record<string, unknown>;
  }): RelayChatStream {
    const room = this._config.room;

    // Check if relay is already present — if so, log immediately.
    // If not, create a promise that resolves when a relay-* participant joins.
    const relayParticipant = this._findRelayParticipant(room);

    const streamId = `relay_${++this._nextStreamSeq}`;
    const requestId = `req-${streamId}-${Date.now()}`;

    let waitForRelay: Promise<void> | undefined;
    if (relayParticipant) {
      dbg.relayStream(
        'chat() called: streamId=%s requestId=%s relayIdentity=%s',
        streamId,
        requestId,
        relayParticipant.identity,
      );
      this._logger.info(
        `RelayLLM: routing prompt via relay participant ${relayParticipant.identity}`,
      );
    } else {
      dbg.relayStream(
        'chat() called: streamId=%s requestId=%s — no relay participant yet, will wait',
        streamId,
        requestId,
      );
      this._logger.info('RelayLLM: relay not yet in room, waiting for relay-* participant');
      waitForRelay = this._waitForRelayParticipant(room);
    }

    const transport = new DataChannelTransport(room, VOICE_ACP_TOPIC);

    return new RelayChatStream(this, transport, {
      chatCtx,
      toolCtx,
      connOptions: connOptions || {
        maxRetry: 0,
        retryIntervalMs: 0,
        timeoutMs: this._promptTimeoutMs,
      },
      streamId,
      requestId,
      onPondering: this._onPondering,
      onContent: this._onContent,
      promptTimeoutMs: this._promptTimeoutMs,
      waitForRelay,
    });
  }

  /**
   * Find a relay-* participant in the room's remote participants.
   */
  private _findRelayParticipant(room: RelayRoom): { identity: string } | undefined {
    for (const [, participant] of room.remoteParticipants) {
      if (participant.identity.startsWith('relay-')) {
        return participant;
      }
    }
    return undefined;
  }

  /**
   * Returns a promise that resolves when a relay-* participant joins the room,
   * or rejects after RELAY_WAIT_TIMEOUT_MS.
   */
  private _waitForRelayParticipant(room: RelayRoom): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        room.off('participantConnected', onParticipant);
        const identities = Array.from(room.remoteParticipants.values())
          .map((p) => p.identity)
          .join(', ') || '(none)';
        reject(new Error(
          `RelayLLM: no relay-* participant joined within ${RELAY_WAIT_TIMEOUT_MS}ms. ` +
          `Remote participants: ${identities}.`,
        ));
      }, RELAY_WAIT_TIMEOUT_MS);

      const onParticipant = (p: { identity: string }) => {
        if (p.identity.startsWith('relay-')) {
          clearTimeout(timeout);
          room.off('participantConnected', onParticipant);
          this._logger.info(`RelayLLM: relay participant joined: ${p.identity}`);
          resolve();
        }
      };

      room.on('participantConnected', onParticipant);

      // Double-check in case relay joined between chat() and this listener.
      if (this._findRelayParticipant(room)) {
        clearTimeout(timeout);
        room.off('participantConnected', onParticipant);
        resolve();
      }
    });
  }

  /**
   * No-op: RelayLLM has no subprocess to shut down.
   */
  async aclose(): Promise<void> {
    // Nothing to clean up — the data channel is owned by the Room.
    this._logger.info('RelayLLM: aclose() (no-op)');
  }
}

// Register with ganglia factory
registerGanglia('relay', async () => RelayLLM as any);
