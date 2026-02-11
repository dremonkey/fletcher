import { llm, APIConnectOptions } from '@livekit/agents';
import { OpenClawClient } from './client.js';
import {
  OpenClawConfig,
  OpenClawMessage,
  OpenClawToolCallDelta,
  LiveKitSessionInfo,
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

export class OpenClawLLM extends LLMBase {
  private client: OpenClawClient;
  private _model: string;

  constructor(config: OpenClawConfig = {}) {
    super();
    this.client = new OpenClawClient(config);
    this._model = config.model || 'openclaw-gateway';
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
   * Sets the default session for all subsequent chat requests.
   */
  setDefaultSession(session: LiveKitSessionInfo): void {
    this.client.setDefaultSession(session);
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
    });
  }
}

class OpenClawChatStream extends LLMStream {
  private openclawClient: OpenClawClient;

  constructor(
    llmInstance: OpenClawLLM,
    client: OpenClawClient,
    {
      chatCtx,
      toolCtx,
      connOptions,
    }: {
      chatCtx: ChatContext;
      toolCtx?: ToolContext;
      connOptions: APIConnectOptions;
    },
  ) {
    super(llmInstance, { chatCtx, toolCtx, connOptions });
    this.openclawClient = client;
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
      // Get tools from tool context (ToolContext is an object where keys are tool names)
      const tools = toolCtx ? Object.values(toolCtx).map((tool: any) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      })) : undefined;

      // Extract session info from LiveKit context
      const session = extractSessionFromContext(chatCtx, connOptions);

      const stream = this.openclawClient.chat({
        messages,
        stream: true,
        tools: tools && tools.length > 0 ? tools : undefined,
        session,
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
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
      console.error('OpenClaw stream error:', error);
      throw error;
    } finally {
      this.output.close();
    }
  }
}
