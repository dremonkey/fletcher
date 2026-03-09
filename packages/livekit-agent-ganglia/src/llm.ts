import { llm, APIConnectOptions } from '@livekit/agents';
import { type GangliaLLM, registerGanglia } from './factory.js';
import { type GangliaSessionInfo } from './ganglia-types.js';
import { type SessionKey } from './session-routing.js';
import { OpenClawClient } from './client.js';
import {
  OpenClawConfig,
  OpenClawMessage,
  OpenClawToolCallDelta,
  LiveKitSessionInfo,
} from './types/index.js';
import type { InputItem, OpenClawRespondOptions } from './types/openresponses.js';
import { dbg } from './logger.js';
import { getShuffledPhrases } from './pondering.js';

// Re-export types from @livekit/agents
type ChatChunk = llm.ChatChunk;
type ChatContext = llm.ChatContext;
type ToolContext = llm.ToolContext;
type ToolChoice = llm.ToolChoice;
type ChatRole = llm.ChatRole;
type FunctionCall = llm.FunctionCall;

// Runtime values
const LLMBase = llm.LLM;
const LLMStream = llm.LLMStream;
const ChatMessageClass = llm.ChatMessage;
const FunctionCallClass = llm.FunctionCall;

/**
 * Extracts LiveKit session info from ChatContext and connection options.
 * This maps LiveKit identifiers to OpenClaw session headers for persistent state.
 */
export function extractSessionFromContext(
  chatCtx: ChatContext,
  connOptions?: APIConnectOptions & { sessionId?: string },
): LiveKitSessionInfo {
  const session: LiveKitSessionInfo = {};

  // Try to extract room info from ChatContext
  // LiveKit's ChatContext may have room metadata attached
  const ctxAny = chatCtx as any;

  if (ctxAny.room) {
    session.roomName = ctxAny.room.name;
    session.roomSid = ctxAny.room.sid;
  }

  if (ctxAny.participant) {
    session.participantIdentity = ctxAny.participant.identity;
    session.participantSid = ctxAny.participant.sid;
  }

  // Check for session info in metadata
  if (ctxAny.metadata?.sessionId) {
    session.customSessionId = ctxAny.metadata.sessionId;
  }

  // Connection options can also provide session info
  if (connOptions?.sessionId) {
    session.customSessionId = connOptions.sessionId;
  }

  // Check for room/participant in connection options (extended types)
  const connAny = connOptions as any;
  if (connAny?.roomSid && !session.roomSid) {
    session.roomSid = connAny.roomSid;
  }
  if (connAny?.roomName && !session.roomName) {
    session.roomName = connAny.roomName;
  }
  if (connAny?.participantIdentity && !session.participantIdentity) {
    session.participantIdentity = connAny.participantIdentity;
  }
  if (connAny?.participantSid && !session.participantSid) {
    session.participantSid = connAny.participantSid;
  }

  return session;
}

export class OpenClawLLM extends LLMBase implements GangliaLLM {
  private client: OpenClawClient;
  private _model: string;
  private _sessionKey?: SessionKey;
  private _historyMode: 'full' | 'latest';
  private _useOpenResponses: boolean;
  private _onPondering?: (phrase: string | null, streamId: string) => void;
  private _onContent?: (delta: string, fullText: string, streamId: string) => void;
  private _nextStreamSeq = 0;

  constructor(config: OpenClawConfig = {}) {
    super();
    this.client = new OpenClawClient(config);
    this._model = config.model || 'openclaw-gateway';
    this._historyMode = config.historyMode ?? 'latest';
    this._useOpenResponses = config.useOpenResponses ?? (process.env.USE_OPENRESPONSES === 'true');
    this._onPondering = config.onPondering;
    this._onContent = config.onContent;

    // Guard against duplicate @livekit/agents installs — the voice pipeline
    // uses `instanceof LLM` to gate the chat() call, and a second copy of the
    // package silently breaks that check.  Fail loudly instead.
    if (!(this instanceof LLMBase)) {
      const msg = [
        'OpenClawLLM: instanceof LLM check failed — likely duplicate @livekit/agents installs.',
        'Ensure @livekit/agents is a peerDependency (not a direct dependency) in livekit-agent-ganglia.',
        'Run: bun why @livekit/agents',
      ].join(' ');
      dbg.openclawStream(msg);
      throw new Error(msg);
    }
  }

  /**
   * Returns the ganglia type identifier.
   */
  gangliaType(): string {
    return 'openclaw';
  }

  label(): string {
    return 'openclaw';
  }

  get model(): string {
    return this._model;
  }

  /**
   * Returns the underlying OpenClawClient for direct access if needed.
   */
  getClient(): OpenClawClient {
    return this.client;
  }

  /**
   * Sets the default session metadata for all subsequent chat requests.
   */
  setDefaultSession(session: LiveKitSessionInfo | GangliaSessionInfo): void {
    this.client.setDefaultSession(session as LiveKitSessionInfo);
  }

  /**
   * Sets the session key for routing. This determines which backend
   * session the conversation routes to (owner/guest/room).
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
   * Returns whether this LLM instance is configured to use the OpenResponses API.
   */
  isUsingOpenResponses(): boolean {
    return this._useOpenResponses;
  }

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
  }): OpenClawChatStream {
    const streamId = `s_${++this._nextStreamSeq}`;
    return new OpenClawChatStream(this, this.client, {
      chatCtx,
      toolCtx,
      connOptions: connOptions || { maxRetry: 3, retryIntervalMs: 2000, timeoutMs: 10000 },
      sessionKey: this._sessionKey,
      historyMode: this._historyMode,
      useOpenResponses: this._useOpenResponses,
      onPondering: this._onPondering,
      onContent: this._onContent,
      streamId,
    });
  }
}

/**
 * Converts an array of OpenClawMessages (Chat Completions format) to
 * OpenResponses InputItems. This bridges the existing message serialization
 * with the new /v1/responses endpoint.
 *
 * Simple case: a single user message -> just the text string.
 * Complex case: multi-turn / tool calls -> array of InputItems.
 */
export function convertMessagesToInput(messages: OpenClawMessage[]): string | InputItem[] {
  // Simple case: single user message with text content
  if (messages.length === 1 && messages[0].role === 'user' && messages[0].content && !messages[0].tool_calls) {
    return messages[0].content;
  }

  // Complex case: map to InputItems
  const items: InputItem[] = [];
  for (const msg of messages) {
    if (msg.role === 'tool') {
      // Tool results -> function_call_output items
      items.push({
        type: 'function_call_output',
        call_id: msg.tool_call_id,
        output: msg.content || '',
      });
    } else {
      // Regular messages -> message items
      const item: InputItem = {
        type: 'message',
        role: msg.role as 'system' | 'user' | 'assistant',
        content: msg.content
          ? [{ type: 'text' as const, text: msg.content }]
          : undefined,
      };
      items.push(item);
    }
  }

  return items;
}

/** How often to rotate the pondering phrase (ms). */
const PONDERING_INTERVAL_MS = 3000;

class OpenClawChatStream extends LLMStream {
  private openclawClient: OpenClawClient;
  private _sessionKey?: SessionKey;
  private _historyMode: 'full' | 'latest';
  private _useOpenResponses: boolean;
  private _onPondering?: (phrase: string | null, streamId: string) => void;
  private _onContent?: (delta: string, fullText: string, streamId: string) => void;
  private _streamId: string;

  constructor(
    llmInstance: OpenClawLLM,
    client: OpenClawClient,
    {
      chatCtx,
      toolCtx,
      connOptions,
      sessionKey,
      historyMode,
      useOpenResponses,
      onPondering,
      onContent,
      streamId,
    }: {
      chatCtx: ChatContext;
      toolCtx?: ToolContext;
      connOptions: APIConnectOptions;
      sessionKey?: SessionKey;
      historyMode: 'full' | 'latest';
      useOpenResponses: boolean;
      onPondering?: (phrase: string | null, streamId: string) => void;
      onContent?: (delta: string, fullText: string, streamId: string) => void;
      streamId: string;
    },
  ) {
    super(llmInstance, { chatCtx, toolCtx, connOptions });
    this.openclawClient = client;
    this._sessionKey = sessionKey;
    this._historyMode = historyMode;
    this._useOpenResponses = useOpenResponses;
    this._onPondering = onPondering;
    this._onContent = onContent;
    this._streamId = streamId;
  }

  protected async run(): Promise<void> {
    dbg.openclawStream('run() called');
    const messages: OpenClawMessage[] = [];
    const chatCtx = this.chatCtx;
    const toolCtx = this.toolCtx;
    const connOptions = this.connOptions;

    let itemsToProcess = chatCtx.items;

    if (this._historyMode === 'latest') {
      // Find the last user message and only send from there onwards.
      // This preserves tool-call re-entries (user → assistant tool_call → tool result).
      let lastUserIdx = -1;
      for (let i = itemsToProcess.length - 1; i >= 0; i--) {
        if (itemsToProcess[i] instanceof ChatMessageClass &&
            (itemsToProcess[i] as any).role === 'user') {
          lastUserIdx = i;
          break;
        }
      }
      if (lastUserIdx >= 0) {
        itemsToProcess = itemsToProcess.slice(lastUserIdx);
      }
      dbg.openclawStream('historyMode=latest: %d/%d items (lastUserIdx=%d)',
        itemsToProcess.length, chatCtx.items.length, lastUserIdx);
    }

    dbg.openclawStream('chatCtx.items count: %d', itemsToProcess.length);
    for (const item of itemsToProcess) {
      dbg.openclawStream('item type=%s instanceof ChatMessage=%s FunctionCall=%s',
        item?.constructor?.name, item instanceof ChatMessageClass, item instanceof FunctionCallClass);
      if (item instanceof ChatMessageClass) {
        // Skip empty system messages — an empty system content causes some
        // LLM backends to hang (no SSE chunks returned).
        if (item.role === 'system' && !item.textContent) continue;

        let content = item.textContent || undefined;

        // TASK-013: Voice-Aware Metadata Tagging — previously wrapped every user
        // message with STT/TTS context.  Now sent once as a bootstrap message at
        // session start (see apps/voice-agent/src/bootstrap.ts).

        const msg: OpenClawMessage = {
          role: item.role as OpenClawMessage['role'],
          content,
        };
        messages.push(msg);
      } else if (item instanceof FunctionCallClass) {
        // This is a function call from the assistant
        const lastMsg = messages[messages.length - 1];
        if (lastMsg && lastMsg.role === 'assistant') {
          if (!lastMsg.tool_calls) {
            lastMsg.tool_calls = [];
          }
          lastMsg.tool_calls.push({
            id: item.callId,
            type: 'function',
            function: {
              name: item.name,
              arguments: item.args,
            },
          });
        } else {
          // Create a new assistant message with the tool call
          messages.push({
            role: 'assistant',
            tool_calls: [{
              id: item.callId,
              type: 'function',
              function: {
                name: item.name,
                arguments: item.args,
              },
            }],
          });
        }
      } else if ('type' in item && item.type === 'function_call_output') {
        // This is a tool response
        const output = item as any;
        messages.push({
          role: 'tool',
          content: output.output,
          tool_call_id: output.callId,
          name: output.name,
        });
      }
    }

    let ponderingTimer: ReturnType<typeof setInterval> | undefined;

    try {
      // Get tools from tool context (ToolContext is an object where keys are tool names)
      const tools = toolCtx ? Object.values(toolCtx).map((tool: any) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      })) : undefined;

      dbg.openclawStream('converted %d messages, %d tools', messages.length, tools?.length ?? 0);
      if (messages.length > 0) {
        const lastMsg = messages[messages.length - 1];
        dbg.openclawStream('last message: role=%s content="%s"',
          lastMsg.role, (lastMsg.content || '').slice(0, 100));
      }

      // Extract session metadata from LiveKit context (informational headers)
      const session = extractSessionFromContext(chatCtx, connOptions);
      dbg.openclawStream('session: %O', session);
      dbg.openclawStream('sessionKey: %O', this._sessionKey);

      const streamStart = performance.now();
      const stream = this._useOpenResponses
        ? this.openclawClient.respondAsChat({
            input: convertMessagesToInput(messages),
            stream: true,
            tools: tools && tools.length > 0 ? tools : undefined,
            session,
            sessionKey: this._sessionKey,
            signal: this.abortController.signal,
          })
        : this.openclawClient.chat({
            messages,
            stream: true,
            tools: tools && tools.length > 0 ? tools : undefined,
            session,
            sessionKey: this._sessionKey,
            signal: this.abortController.signal,
          });

      // Start pondering: emit rotating fun phrases while waiting for first content
      if (this._onPondering) {
        const phrases = getShuffledPhrases();
        let idx = 0;
        this._onPondering(phrases[idx], this._streamId);
        dbg.openclawStream('pondering: "%s" streamId=%s', phrases[idx], this._streamId);
        ponderingTimer = setInterval(() => {
          idx = (idx + 1) % phrases.length;
          this._onPondering!(phrases[idx], this._streamId);
          dbg.openclawStream('pondering: "%s" streamId=%s', phrases[idx], this._streamId);
        }, PONDERING_INTERVAL_MS);
      }

      let chunkCount = 0;
      let firstChunkAt: number | undefined;
      let firstContentSeen = false;
      let accumulatedContent = '';
      for await (const chunk of stream) {
        // Exit early if the stream has been aborted (e.g. user interruption)
        if (this.closed) {
          dbg.openclawStream('stream closed, exiting run() loop');
          break;
        }

        chunkCount++;
        if (!firstChunkAt) {
          firstChunkAt = performance.now();
          dbg.openclawStream('timing: streamStart→firstChunk=%dms', Math.round(firstChunkAt - streamStart));
        }

        // Stop pondering on first content-bearing chunk
        const hasContent = !!chunk.choices[0]?.delta?.content;
        if (hasContent && !firstContentSeen) {
          firstContentSeen = true;
          if (ponderingTimer) {
            clearInterval(ponderingTimer);
            ponderingTimer = undefined;
          }
          this._onPondering?.(null, this._streamId);
          dbg.openclawStream('pondering: cleared (first content at %dms) streamId=%s', Math.round(performance.now() - streamStart), this._streamId);
        }

        const delta = chunk.choices[0]?.delta;
        if (!delta) {
          dbg.openclawStream('chunk %d: no delta', chunkCount);
          continue;
        }

        if (chunkCount <= 3 || delta.tool_calls) {
          dbg.openclawStream('chunk %d: role=%s content="%s" hasToolCalls=%s',
            chunkCount, delta.role, (delta.content || '').slice(0, 50), !!delta.tool_calls);
        }

        // Fire onContent for each content-bearing chunk
        if (delta.content && this._onContent) {
          accumulatedContent += delta.content;
          this._onContent(delta.content, accumulatedContent, this._streamId);
        }

        // Map tool calls to FunctionCall format if present
        let toolCalls: FunctionCall[] | undefined;
        if (delta.tool_calls) {
          toolCalls = delta.tool_calls.map((tc: OpenClawToolCallDelta) =>
            new FunctionCallClass({
              callId: tc.id || '',
              name: tc.function?.name || '',
              args: tc.function?.arguments || '',
            })
          );
        }

        const chatChunk: ChatChunk = {
          id: chunk.id,
          delta: {
            role: (delta.role as ChatRole) || 'assistant',
            content: delta.content || undefined,
            toolCalls,
          },
        };
        try {
          this.queue.put(chatChunk);
        } catch (e) {
          if (e instanceof Error && e.message === 'Queue is closed') {
            dbg.openclawStream('queue closed during put (expected during interruption)');
            break;
          }
          throw e;
        }
      }
      const streamDurationMs = Math.round(performance.now() - streamStart);
      dbg.openclawStream('stream complete, %d chunks in %dms', chunkCount, streamDurationMs);
    } catch (error) {
      this.logger.error(`OpenClawChatStream error: ${error}`);
      throw error;
    } finally {
      if (ponderingTimer) {
        clearInterval(ponderingTimer);
      }
      this._onPondering?.(null, this._streamId);
      // NOTE: Do NOT close this.output here. The base class monitorMetrics() method
      // handles closing this.output after draining this.queue. Closing it here would
      // bypass metrics collection and could drop in-flight chunks.
    }
  }
}

// Register with ganglia factory
registerGanglia('openclaw', async () => OpenClawLLM as any);
