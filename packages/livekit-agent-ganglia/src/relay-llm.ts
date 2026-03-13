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
import type { GangliaSessionInfo, RelayConfig } from './ganglia-types.js';
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
   * Scans room participants for a relay-* identity. Throws immediately if
   * none found — no retry/fallback in this implementation phase.
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

    // Locate the relay participant (identity starts with "relay-").
    let relayParticipant: { identity: string } | undefined;
    for (const [, participant] of room.remoteParticipants) {
      if (participant.identity.startsWith('relay-')) {
        relayParticipant = participant;
        break;
      }
    }

    if (!relayParticipant) {
      const identities = Array.from(room.remoteParticipants.values())
        .map((p) => p.identity)
        .join(', ') || '(none)';
      throw new Error(
        `RelayLLM: no relay-* participant found in room. ` +
          `Remote participants: ${identities}. ` +
          `Ensure the relay has joined the room before starting a chat session.`,
      );
    }

    const streamId = `relay_${++this._nextStreamSeq}`;
    const requestId = `req-${streamId}-${Date.now()}`;
    dbg.relayStream(
      'chat() called: streamId=%s requestId=%s relayIdentity=%s',
      streamId,
      requestId,
      relayParticipant.identity,
    );

    this._logger.info(
      `RelayLLM: routing prompt via relay participant ${relayParticipant.identity}`,
    );

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
