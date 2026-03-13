/**
 * AcpLLM — LiveKit LLM backend using ACP (JSON-RPC 2.0 over stdio).
 *
 * Replaces the OpenClaw HTTP backend with a full-duplex ACP connection.
 * One subprocess is spawned per AcpLLM instance on the first chat() call
 * (lazy init). The subprocess lifecycle is tied to the voice agent session.
 */
import { llm, APIConnectOptions } from '@livekit/agents';
import { AcpClient } from '@fletcher/acp-client';
import type { SessionMeta } from '@fletcher/acp-client';
import { type GangliaLLM, registerGanglia } from './factory.js';
import type { GangliaSessionInfo, AcpConfig } from './ganglia-types.js';
import type { SessionKey } from './session-routing.js';
import { type Logger, noopLogger, dbg } from './logger.js';
import { AcpChatStream } from './acp-stream.js';

type ChatContext = llm.ChatContext;
type ToolContext = llm.ToolContext;
type ToolChoice = llm.ToolChoice;

const LLMBase = llm.LLM;

/** Default prompt timeout: 2 minutes. */
const DEFAULT_PROMPT_TIMEOUT_MS = 120_000;

export class AcpLLM extends LLMBase implements GangliaLLM {
  private _config: AcpConfig;
  private _logger: Logger;
  private _sessionKey?: SessionKey;
  private _defaultSession?: GangliaSessionInfo;
  /**
   * Resolves to { client, sessionId } once the subprocess is ready.
   * Coalesces concurrent chat() calls during startup.
   */
  private _initPromise: Promise<{ client: AcpClient; sessionId: string }> | null = null;
  private _onPondering?: (phrase: string | null, streamId: string) => void;
  private _onContent?: (delta: string, fullText: string, streamId: string) => void;
  private _nextStreamSeq = 0;
  private _promptTimeoutMs: number;

  constructor(config: AcpConfig) {
    super();
    this._config = config;
    this._logger = config.logger ?? noopLogger;
    this._onPondering = config.onPondering;
    this._onContent = config.onContent;
    this._promptTimeoutMs =
      config.promptTimeoutMs ??
      (process.env.ACP_PROMPT_TIMEOUT_MS
        ? parseInt(process.env.ACP_PROMPT_TIMEOUT_MS, 10)
        : DEFAULT_PROMPT_TIMEOUT_MS);

    // Guard against duplicate @livekit/agents installs
    if (!(this instanceof LLMBase)) {
      const msg = [
        'AcpLLM: instanceof LLM check failed — likely duplicate @livekit/agents installs.',
        'Ensure @livekit/agents is a peerDependency (not a direct dependency) in livekit-agent-ganglia.',
        'Run: bun why @livekit/agents',
      ].join(' ');
      dbg.acpStream(msg);
      throw new Error(msg);
    }
  }

  /**
   * Returns the ganglia type identifier.
   */
  gangliaType(): string {
    return 'acp';
  }

  label(): string {
    return 'acp';
  }

  get model(): string {
    return 'acp';
  }

  /**
   * Sets the default session metadata for all subsequent chat requests.
   * Must be called before the first chat() to be included in session/new.
   */
  setDefaultSession(session: GangliaSessionInfo): void {
    this._defaultSession = session;
  }

  /**
   * Sets the session key for routing. This is passed to session/new via _meta.
   * Must be called before the first chat() to be included in session/new.
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
   * Lazy init: spawn subprocess + initialize + session/new on first chat() call.
   * Idempotent — coalesces concurrent calls via _initPromise.
   */
  private ensureInitialized(): Promise<{ client: AcpClient; sessionId: string }> {
    if (!this._initPromise) {
      this._initPromise = this._doInit();
    }
    return this._initPromise;
  }

  private async _doInit(): Promise<{ client: AcpClient; sessionId: string }> {
    dbg.acpStream(
      'ensureInitialized: spawning ACP subprocess command=%s args=%o',
      this._config.command,
      this._config.args,
    );

    const logger = this._logger;
    const client = new AcpClient({
      command: this._config.command,
      args: this._config.args,
      env: this._config.env,
      logger: {
        info: (obj, msg) => logger.info(msg ?? JSON.stringify(obj)),
        warn: (obj, msg) => logger.warn(msg ?? JSON.stringify(obj)),
        error: (obj, msg) => logger.error(msg ?? JSON.stringify(obj)),
        debug: (obj, msg) => logger.debug(msg ?? JSON.stringify(obj)),
      },
    });

    // Spawn + initialize handshake
    this._logger.info('AcpLLM: initializing ACP subprocess');
    await client.initialize();
    dbg.acpStream('ACP initialized');

    // Build _meta for session/new
    const meta: SessionMeta = {};

    if (this._sessionKey) {
      meta.session_key = { type: this._sessionKey.type, key: this._sessionKey.key };
    }

    if (this._defaultSession?.roomName) {
      meta.room_name = this._defaultSession.roomName;
    }

    if (this._defaultSession?.participantIdentity) {
      meta.participant_identity = this._defaultSession.participantIdentity;
    }

    dbg.acpStream('session/new: meta=%O', meta);
    const sessionResult = await client.sessionNew({ _meta: meta });
    const sessionId = sessionResult.sessionId;
    this._logger.info(`AcpLLM: ACP session created sessionId=${sessionId}`);
    dbg.acpStream('ACP session created: sessionId=%s', sessionId);

    return { client, sessionId };
  }

  /**
   * Creates a new chat stream for a user turn.
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
  }): AcpChatStream {
    const streamId = `acp_${++this._nextStreamSeq}`;
    dbg.acpStream('chat() called: streamId=%s', streamId);

    // Kick off lazy init (no-op after first call)
    const initPromise = this.ensureInitialized();

    return new AcpChatStream(this, initPromise, {
      chatCtx,
      toolCtx,
      connOptions: connOptions || {
        maxRetry: 0,
        retryIntervalMs: 0,
        timeoutMs: this._promptTimeoutMs,
      },
      streamId,
      onPondering: this._onPondering,
      onContent: this._onContent,
      promptTimeoutMs: this._promptTimeoutMs,
    });
  }

  /**
   * Gracefully shut down the ACP subprocess.
   */
  async aclose(): Promise<void> {
    if (this._initPromise) {
      try {
        const { client } = await this._initPromise;
        this._logger.info('AcpLLM: shutting down ACP subprocess');
        await client.shutdown();
      } catch {
        // Init may have failed — ignore
      }
      this._initPromise = null;
    }
  }
}

// Register with ganglia factory
registerGanglia('acp', async () => AcpLLM as any);
