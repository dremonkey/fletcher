/**
 * AcpChatStream — LLMStream implementation for the ACP backend.
 *
 * Bridges a LiveKit LLMStream request to an ACP session/prompt call,
 * mapping agent_message_chunk notifications → ChatChunk events.
 */
import { llm, APIConnectOptions } from '@livekit/agents';
import type { AcpClient, SessionUpdateParams } from '@fletcher/acp-client';
import { dbg } from './logger.js';
import { getShuffledPhrases } from './pondering.js';

type ChatChunk = llm.ChatChunk;
type ChatContext = llm.ChatContext;
type ToolContext = llm.ToolContext;
const LLMStream = llm.LLMStream;
const ChatMessageClass = llm.ChatMessage;

/** How often to rotate the pondering phrase (ms). */
const PONDERING_INTERVAL_MS = 3000;

/**
 * Extracts the latest user message text from a ChatContext.
 * ACP only needs the most recent user utterance — not the full history.
 */
export function extractLatestUserText(chatCtx: ChatContext): string {
  // Walk backwards to find the last user message
  for (let i = chatCtx.items.length - 1; i >= 0; i--) {
    const item = chatCtx.items[i];
    if (item instanceof ChatMessageClass && (item as any).role === 'user') {
      return (item as any).textContent || '';
    }
  }
  return '';
}

export class AcpChatStream extends LLMStream {
  /** Resolved after lazy init — set by AcpLLM before run() executes. */
  private _initPromise: Promise<{ client: AcpClient; sessionId: string }>;
  private _streamId: string;
  private _onPondering?: (phrase: string | null, streamId: string) => void;
  private _onContent?: (delta: string, fullText: string, streamId: string) => void;
  private _promptTimeoutMs: number;
  /** Resolved after init; used in close() for session/cancel. */
  private _client: AcpClient | null = null;
  private _sessionId: string | null = null;

  constructor(
    llmInstance: llm.LLM,
    initPromise: Promise<{ client: AcpClient; sessionId: string }>,
    {
      chatCtx,
      toolCtx,
      connOptions,
      streamId,
      onPondering,
      onContent,
      promptTimeoutMs,
    }: {
      chatCtx: ChatContext;
      toolCtx?: ToolContext;
      connOptions: APIConnectOptions;
      streamId: string;
      onPondering?: (phrase: string | null, streamId: string) => void;
      onContent?: (delta: string, fullText: string, streamId: string) => void;
      promptTimeoutMs: number;
    },
  ) {
    super(llmInstance, { chatCtx, toolCtx, connOptions });
    this._initPromise = initPromise;
    this._streamId = streamId;
    this._onPondering = onPondering;
    this._onContent = onContent;
    this._promptTimeoutMs = promptTimeoutMs;
  }

  protected async run(): Promise<void> {
    // Await lazy init — resolves immediately if already initialized
    const { client, sessionId } = await this._initPromise;
    this._client = client;
    this._sessionId = sessionId;

    dbg.acpStream('run() called, sessionId=%s streamId=%s', sessionId, this._streamId);

    const userText = extractLatestUserText(this.chatCtx);
    dbg.acpStream('user text: "%s"', userText.slice(0, 100));

    let ponderingTimer: ReturnType<typeof setInterval> | undefined;
    let firstContentSeen = false;
    let accumulatedContent = '';

    // Subscribe to session/update notifications from the ACP agent
    const unsubscribe = client.onUpdate((params: SessionUpdateParams) => {
      if (this.closed) {
        dbg.acpStream('stream closed, ignoring update');
        return;
      }

      const { update } = params;
      if (!update || update.sessionUpdate !== 'agent_message_chunk') {
        dbg.acpStream('ignoring non-text update kind: %s', (update as any)?.sessionUpdate);
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
        dbg.acpStream('pondering: cleared (first content) streamId=%s', this._streamId);
      }

      const chunk = update as {
        sessionUpdate: 'agent_message_chunk';
        content: { type: string; text: string };
      };
      const text = chunk.content?.text ?? '';

      if (text && this._onContent) {
        accumulatedContent += text;
        this._onContent(text, accumulatedContent, this._streamId);
      }

      const chatChunk: ChatChunk = {
        id: `acp-${this._streamId}-${Date.now()}`,
        delta: {
          role: 'assistant',
          content: text || undefined,
        },
      };

      try {
        this.queue.put(chatChunk);
      } catch (e) {
        if (e instanceof Error && e.message === 'Queue is closed') {
          dbg.acpStream('queue closed during put (expected during barge-in)');
          // Queue is closed — barge-in scenario; just return from handler
          return;
        }
        throw e;
      }
    });

    try {
      // Start pondering timer
      if (this._onPondering) {
        const phrases = getShuffledPhrases();
        let idx = 0;
        this._onPondering(phrases[idx], this._streamId);
        dbg.acpStream('pondering: "%s" streamId=%s', phrases[idx], this._streamId);
        ponderingTimer = setInterval(() => {
          idx = (idx + 1) % phrases.length;
          this._onPondering!(phrases[idx], this._streamId);
          dbg.acpStream('pondering: "%s" streamId=%s', phrases[idx], this._streamId);
        }, PONDERING_INTERVAL_MS);
      }

      const streamStart = performance.now();
      dbg.acpStream('sending session/prompt, sessionId=%s', sessionId);

      // Send session/prompt with configurable timeout
      const promptPromise = client.sessionPrompt({
        sessionId,
        prompt: [{ type: 'text', text: userText }],
      });

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(`ACP session/prompt timed out after ${this._promptTimeoutMs}ms`),
            ),
          this._promptTimeoutMs,
        ),
      );

      const result = await Promise.race([promptPromise, timeoutPromise]);
      const elapsed = Math.round(performance.now() - streamStart);
      dbg.acpStream(
        'session/prompt complete: stopReason=%s elapsed=%dms',
        result.stopReason,
        elapsed,
      );
    } catch (error) {
      this.logger.error(`AcpChatStream error: ${error}`);
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
   * Barge-in: send session/cancel, then close the stream.
   */
  close(): void {
    dbg.acpStream(
      'close() called (barge-in), sending session/cancel sessionId=%s',
      this._sessionId,
    );
    if (this._client && this._sessionId) {
      try {
        this._client.sessionCancel({ sessionId: this._sessionId });
      } catch (e) {
        // Ignore errors from cancel — process may already be dead
        dbg.acpStream('session/cancel failed (ignored): %s', (e as Error).message);
      }
    }
    super.close();
  }
}
