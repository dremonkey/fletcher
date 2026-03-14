/**
 * RelayChatStream — LLMStream implementation for the relay backend.
 *
 * Bridges a LiveKit LLMStream request to the relay via a StreamTransport,
 * mapping session/update notifications → ChatChunk events. The wire protocol
 * is JSON-RPC 2.0 on the voice-acp data channel topic.
 */
import { llm, APIConnectOptions } from '@livekit/agents';
import type { StreamTransport } from './relay-transport.js';
import { dbg } from './logger.js';
import { getShuffledPhrases } from './pondering.js';
import { extractLatestUserText } from './acp-stream.js';

type ChatChunk = llm.ChatChunk;
type ChatContext = llm.ChatContext;
type ToolContext = llm.ToolContext;
const LLMStream = llm.LLMStream;

/** How often to rotate the pondering phrase (ms). */
const PONDERING_INTERVAL_MS = 3000;

/** Default prompt timeout: 2 minutes. */
const DEFAULT_PROMPT_TIMEOUT_MS = 120_000;

// ---------------------------------------------------------------------------
// JSON-RPC types (wire protocol)
// ---------------------------------------------------------------------------

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string;
  method: string;
  params: object;
}

interface JsonRpcResult {
  jsonrpc: '2.0';
  id: string;
  result: { stopReason?: string };
}

interface JsonRpcError {
  jsonrpc: '2.0';
  id: string;
  error: { code: number; message: string };
}

interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params: {
    sessionId?: string;
    update?: {
      sessionUpdate: string;
      content?: { type: string; text: string };
    };
  };
}

type JsonRpcMessage = JsonRpcResult | JsonRpcError | JsonRpcNotification;

// ---------------------------------------------------------------------------
// RelayChatStream
// ---------------------------------------------------------------------------

export class RelayChatStream extends LLMStream {
  private readonly _transport: StreamTransport;
  private readonly _requestId: string;
  private readonly _streamId: string;
  private readonly _onPondering?: (phrase: string | null, streamId: string) => void;
  private readonly _onContent?: (delta: string, fullText: string, streamId: string) => void;
  private readonly _promptTimeoutMs: number;
  private readonly _waitForRelay?: Promise<void>;

  constructor(
    llmInstance: llm.LLM,
    transport: StreamTransport,
    {
      chatCtx,
      toolCtx,
      connOptions,
      streamId,
      requestId,
      onPondering,
      onContent,
      promptTimeoutMs,
      waitForRelay,
    }: {
      chatCtx: ChatContext;
      toolCtx?: ToolContext;
      connOptions: APIConnectOptions;
      streamId: string;
      requestId: string;
      onPondering?: (phrase: string | null, streamId: string) => void;
      onContent?: (delta: string, fullText: string, streamId: string) => void;
      promptTimeoutMs: number;
      waitForRelay?: Promise<void>;
    },
  ) {
    super(llmInstance, { chatCtx, toolCtx, connOptions });
    this._transport = transport;
    this._requestId = requestId;
    this._streamId = streamId;
    this._onPondering = onPondering;
    this._onContent = onContent;
    this._promptTimeoutMs = promptTimeoutMs;
    this._waitForRelay = waitForRelay;

    // LLMStream.startSoon() discards the promise returned by mainTask.
    // When run() re-throws after emitError(), the rejection becomes unhandled.
    // Suppress it here — the error is already propagated via the LLM "error"
    // event. startSoon schedules a microtask, so this override takes effect
    // before mainTask is invoked.
    //
    // mainTask is declared private in LLMStream .d.ts but is a plain class
    // field at runtime; use `any` to access it and suppress the rejection.
    // Guard with typeof check for test environments that mock LLMStream.
    if (typeof (this as any).mainTask === 'function') {
      const _origMainTask = (this as any).mainTask.bind(this);
      (this as any).mainTask = () => _origMainTask().catch(() => {});
    }
  }

  protected async run(): Promise<void> {
    const userText = extractLatestUserText(this.chatCtx);
    dbg.relayStream(
      'run() called: streamId=%s requestId=%s userText="%s"',
      this._streamId,
      this._requestId,
      userText.slice(0, 100),
    );

    let ponderingTimer: ReturnType<typeof setInterval> | undefined;
    let firstContentSeen = false;
    let accumulatedContent = '';

    // Resolve/reject the prompt when the relay responds with a result or error.
    let resolvePrompt!: () => void;
    let rejectPrompt!: (err: Error) => void;
    const promptPromise = new Promise<void>((res, rej) => {
      resolvePrompt = res;
      rejectPrompt = rej;
    });

    // Subscribe to incoming messages from the relay.
    const unsubscribe = this._transport.onMessage((raw: unknown) => {
      if (this.closed) {
        dbg.relayStream('stream closed, ignoring message');
        return;
      }

      const msg = raw as JsonRpcMessage;

      // Is this a notification (session/update)?
      if ('method' in msg && msg.method === 'session/update') {
        const notif = msg as JsonRpcNotification;
        const update = notif.params?.update;

        if (!update || update.sessionUpdate !== 'agent_message_chunk') {
          dbg.relayStream(
            'ignoring non-text update kind: %s',
            (update as any)?.sessionUpdate,
          );
          return;
        }

        // Stop pondering on first content chunk
        if (!firstContentSeen) {
          firstContentSeen = true;
          if (ponderingTimer) {
            clearInterval(ponderingTimer);
            ponderingTimer = undefined;
          }
          this._onPondering?.(null, this._streamId);
          dbg.relayStream('pondering: cleared (first content) streamId=%s', this._streamId);
        }

        const text = update.content?.text ?? '';

        if (text && this._onContent) {
          accumulatedContent += text;
          this._onContent(text, accumulatedContent, this._streamId);
        }

        const chatChunk: ChatChunk = {
          id: `relay-${this._streamId}-${Date.now()}`,
          delta: {
            role: 'assistant',
            content: text || undefined,
          },
        };

        try {
          this.queue.put(chatChunk);
        } catch (e) {
          if (e instanceof Error && e.message === 'Queue is closed') {
            dbg.relayStream('queue closed during put (expected during barge-in)');
            return;
          }
          throw e;
        }
        return;
      }

      // Is this a result matching our request ID?
      if ('id' in msg && msg.id === this._requestId) {
        if ('error' in msg) {
          const errMsg = (msg as JsonRpcError).error.message;
          dbg.relayStream('JSON-RPC error response: %s', errMsg);
          rejectPrompt(new Error(`JSON-RPC error from relay: ${errMsg}`));
        } else {
          const stopReason = (msg as JsonRpcResult).result?.stopReason ?? 'unknown';
          dbg.relayStream('prompt complete: stopReason=%s', stopReason);
          resolvePrompt();
        }
      }
    });

    try {
      // Start pondering timer before publishing the request.
      if (this._onPondering) {
        const phrases = getShuffledPhrases();
        let idx = 0;
        this._onPondering(phrases[idx], this._streamId);
        dbg.relayStream('pondering: "%s" streamId=%s', phrases[idx], this._streamId);
        ponderingTimer = setInterval(() => {
          idx = (idx + 1) % phrases.length;
          this._onPondering!(phrases[idx], this._streamId);
          dbg.relayStream('pondering: "%s" streamId=%s', phrases[idx], this._streamId);
        }, PONDERING_INTERVAL_MS);
      }

      // Wait for relay participant if not yet in room (bootstrap race fix).
      if (this._waitForRelay) {
        dbg.relayStream('waiting for relay participant before sending request...');
        await this._waitForRelay;
        dbg.relayStream('relay participant arrived, proceeding with request');
      }

      // Publish the JSON-RPC session/prompt request.
      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        id: this._requestId,
        method: 'session/prompt',
        params: {
          sessionId: null,
          prompt: [{ type: 'text', text: userText }],
        },
      };
      dbg.relayStream('publishing session/prompt: requestId=%s', this._requestId);
      this._transport.sendRequest(request);

      // Race: wait for relay result vs. timeout.
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `relay session/prompt timed out after ${this._promptTimeoutMs}ms`,
              ),
            ),
          this._promptTimeoutMs,
        ),
      );

      await Promise.race([promptPromise, timeoutPromise]);
      dbg.relayStream('run() complete: streamId=%s', this._streamId);
    } catch (error) {
      this.logger.error(`RelayChatStream error: ${error}`);
      throw error;
    } finally {
      unsubscribe();
      if (ponderingTimer) {
        clearInterval(ponderingTimer);
      }
      this._onPondering?.(null, this._streamId);
      // NOTE: Do NOT close this.output here. The base class monitorMetrics()
      // handles closing this.output after draining this.queue. Closing it here
      // would bypass metrics collection and could drop in-flight chunks.
    }
  }

  /**
   * Barge-in: send session/cancel via transport, then close the stream.
   */
  close(): void {
    dbg.relayStream(
      'close() called (barge-in), sending session/cancel requestId=%s',
      this._requestId,
    );
    try {
      this._transport.sendCancel(this._requestId);
    } catch (e) {
      // Ignore errors from cancel — relay may already be done
      dbg.relayStream('sendCancel failed (ignored): %s', (e as Error).message);
    }
    super.close();
  }
}
