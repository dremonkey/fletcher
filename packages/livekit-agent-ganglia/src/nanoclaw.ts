import { llm, APIConnectOptions } from '@livekit/agents';
import { type GangliaLLM, registerGanglia } from './factory.js';
import { type GangliaSessionInfo, type NanoclawConfig } from './ganglia-types.js';
import { type SessionKey } from './session-routing.js';
import { NanoclawClient } from './nanoclaw-client.js';
import type {
  OpenClawMessage,
  OpenClawToolCallDelta,
} from './types/index.js';

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
 * Extracts session info from ChatContext for Nanoclaw.
 * Similar to OpenClaw's extractSessionFromContext but simpler.
 */
export function extractNanoclawSession(
  chatCtx: ChatContext,
  connOptions?: APIConnectOptions & { sessionId?: string },
): GangliaSessionInfo {
  const session: GangliaSessionInfo = {};
  const ctxAny = chatCtx as any;

  if (ctxAny.room) {
    session.roomName = ctxAny.room.name;
    session.roomSid = ctxAny.room.sid;
  }

  if (ctxAny.participant) {
    session.participantIdentity = ctxAny.participant.identity;
    session.participantSid = ctxAny.participant.sid;
  }

  if (ctxAny.metadata?.sessionId) {
    session.customSessionId = ctxAny.metadata.sessionId;
  }

  if (connOptions?.sessionId) {
    session.customSessionId = connOptions.sessionId;
  }

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

/**
 * NanoclawLLM - LiveKit LLM implementation for Nanoclaw backend.
 *
 * Nanoclaw is a single-user personal assistant that exposes an
 * OpenAI-compatible API via the /add-openai-api skill.
 *
 * Key differences from OpenClawLLM:
 * - No authentication required (localhost only)
 * - Uses X-Nanoclaw-Channel header for JID-based session tracking
 * - Supports cross-channel history (WhatsApp, Telegram, etc.)
 * - Can emit status and artifact events for visual feedback
 */
export class NanoclawLLM extends LLMBase implements GangliaLLM {
  private client: NanoclawClient;
  private _model: string;
  private _sessionKey?: SessionKey;

  constructor(config: NanoclawConfig) {
    super();
    this.client = new NanoclawClient(config);
    this._model = 'nanoclaw';
  }

  /**
   * Returns the ganglia type identifier.
   */
  gangliaType(): string {
    return 'nanoclaw';
  }

  label(): string {
    return 'nanoclaw';
  }

  get model(): string {
    return this._model;
  }

  /**
   * Returns the underlying NanoclawClient for direct access if needed.
   */
  getClient(): NanoclawClient {
    return this.client;
  }

  /**
   * Sets the default session metadata for all subsequent chat requests.
   */
  setDefaultSession(session: GangliaSessionInfo): void {
    this.client.setDefaultSession(session);
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
  }): NanoclawChatStream {
    return new NanoclawChatStream(this, this.client, {
      chatCtx,
      toolCtx,
      connOptions: connOptions || { maxRetry: 3, retryIntervalMs: 2000, timeoutMs: 10000 },
      sessionKey: this._sessionKey,
    });
  }
}

class NanoclawChatStream extends LLMStream {
  private nanoclawClient: NanoclawClient;
  private _sessionKey?: SessionKey;

  constructor(
    llmInstance: NanoclawLLM,
    client: NanoclawClient,
    {
      chatCtx,
      toolCtx,
      connOptions,
      sessionKey,
    }: {
      chatCtx: ChatContext;
      toolCtx?: ToolContext;
      connOptions: APIConnectOptions;
      sessionKey?: SessionKey;
    },
  ) {
    super(llmInstance, { chatCtx, toolCtx, connOptions });
    this.nanoclawClient = client;
    this._sessionKey = sessionKey;
  }

  protected async run(): Promise<void> {
    const messages: OpenClawMessage[] = [];
    const chatCtx = this.chatCtx;
    const toolCtx = this.toolCtx;
    const connOptions = this.connOptions;

    for (const item of chatCtx.items) {
      if (item instanceof ChatMessageClass) {
        const msg: OpenClawMessage = {
          role: item.role as OpenClawMessage['role'],
          content: item.textContent || undefined,
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

    try {
      // Get tools from tool context
      const tools = toolCtx ? Object.values(toolCtx).map((tool: any) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      })) : undefined;

      // Extract session metadata from LiveKit context
      const session = extractNanoclawSession(chatCtx, connOptions);

      const stream = this.nanoclawClient.chat({
        messages,
        stream: true,
        tools: tools && tools.length > 0 ? tools : undefined,
        session,
        sessionKey: this._sessionKey,
      });

      for await (const chunk of stream) {
        // Handle extended events (status, artifact) - pass through
        if ('type' in chunk && (chunk.type === 'status' || chunk.type === 'artifact')) {
          // These are extended events - emit them as metadata chunks
          // The ToolInterceptor or event handler can process these
          const metaChunk: ChatChunk = {
            id: `meta-${Date.now()}`,
            delta: {
              role: 'assistant',
              content: undefined,
            },
            // Store extended event in metadata (non-standard but useful)
            ...(chunk as any),
          };
          this.output.put(metaChunk);
          continue;
        }

        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;

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
        this.output.put(chatChunk);
      }
    } catch (error) {
      console.error('Nanoclaw stream error:', error);
      throw error;
    } finally {
      this.output.close();
    }
  }
}

// Register with ganglia factory
registerGanglia('nanoclaw', async () => NanoclawLLM as any);
