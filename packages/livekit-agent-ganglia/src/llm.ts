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
import { dbg } from './logger.js';

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

  constructor(config: OpenClawConfig = {}) {
    super();
    this.client = new OpenClawClient(config);
    this._model = config.model || 'openclaw-gateway';

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
    return new OpenClawChatStream(this, this.client, {
      chatCtx,
      toolCtx,
      connOptions: connOptions || { maxRetry: 3, retryIntervalMs: 2000, timeoutMs: 10000 },
      sessionKey: this._sessionKey,
    });
  }
}

class OpenClawChatStream extends LLMStream {
  private openclawClient: OpenClawClient;
  private _sessionKey?: SessionKey;

  constructor(
    llmInstance: OpenClawLLM,
    client: OpenClawClient,
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
    this.openclawClient = client;
    this._sessionKey = sessionKey;
  }

  protected async run(): Promise<void> {
    dbg.openclawStream('run() called');
    const messages: OpenClawMessage[] = [];
    const chatCtx = this.chatCtx;
    const toolCtx = this.toolCtx;
    const connOptions = this.connOptions;

    dbg.openclawStream('chatCtx.items count: %d', chatCtx.items?.length ?? 0);
    for (const item of chatCtx.items) {
      dbg.openclawStream('item type=%s instanceof ChatMessage=%s FunctionCall=%s',
        item?.constructor?.name, item instanceof ChatMessageClass, item instanceof FunctionCallClass);
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

      const stream = this.openclawClient.chat({
        messages,
        stream: true,
        tools: tools && tools.length > 0 ? tools : undefined,
        session,
        sessionKey: this._sessionKey,
      });

      let chunkCount = 0;
      for await (const chunk of stream) {
        chunkCount++;
        const delta = chunk.choices[0]?.delta;
        if (!delta) {
          dbg.openclawStream('chunk %d: no delta', chunkCount);
          continue;
        }

        if (chunkCount <= 3 || delta.tool_calls) {
          dbg.openclawStream('chunk %d: role=%s content="%s" hasToolCalls=%s',
            chunkCount, delta.role, (delta.content || '').slice(0, 50), !!delta.tool_calls);
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
        this.output.put(chatChunk);
      }
      dbg.openclawStream('stream complete, %d chunks received', chunkCount);
    } catch (error) {
      this.logger.error(`OpenClawChatStream error: ${error}`);
      throw error;
    } finally {
      this.output.close();
    }
  }
}

// Register with ganglia factory
registerGanglia('openclaw', async () => OpenClawLLM as any);
