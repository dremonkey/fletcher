import { llm } from '@livekit/agents';
import { registerGanglia } from './factory.js';
import { NanoclawClient } from './nanoclaw-client.js';
import { dbg } from './logger.js';
// Runtime values
const LLMBase = llm.LLM;
const LLMStream = llm.LLMStream;
const ChatMessageClass = llm.ChatMessage;
const FunctionCallClass = llm.FunctionCall;
/**
 * Extracts session info from ChatContext for Nanoclaw.
 * Similar to OpenClaw's extractSessionFromContext but simpler.
 */
export function extractNanoclawSession(chatCtx, connOptions) {
    const session = {};
    const ctxAny = chatCtx;
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
    const connAny = connOptions;
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
export class NanoclawLLM extends LLMBase {
    client;
    _model;
    _sessionKey;
    constructor(config) {
        super();
        this.client = new NanoclawClient(config);
        this._model = 'nanoclaw';
        if (!(this instanceof LLMBase)) {
            const msg = [
                'NanoclawLLM: instanceof LLM check failed — likely duplicate @livekit/agents installs.',
                'Ensure @livekit/agents is a peerDependency (not a direct dependency) in livekit-agent-ganglia.',
                'Run: bun why @livekit/agents',
            ].join(' ');
            dbg.nanoclawStream(msg);
            throw new Error(msg);
        }
    }
    /**
     * Returns the ganglia type identifier.
     */
    gangliaType() {
        return 'nanoclaw';
    }
    label() {
        return 'nanoclaw';
    }
    get model() {
        return this._model;
    }
    /**
     * Returns the underlying NanoclawClient for direct access if needed.
     */
    getClient() {
        return this.client;
    }
    /**
     * Sets the default session metadata for all subsequent chat requests.
     */
    setDefaultSession(session) {
        this.client.setDefaultSession(session);
    }
    /**
     * Sets the session key for routing. This determines which backend
     * session the conversation routes to (owner/guest/room).
     */
    setSessionKey(sessionKey) {
        this._sessionKey = sessionKey;
    }
    /**
     * Returns the current session key, if set.
     */
    getSessionKey() {
        return this._sessionKey;
    }
    chat({ chatCtx, toolCtx, connOptions, }) {
        return new NanoclawChatStream(this, this.client, {
            chatCtx,
            toolCtx,
            connOptions: connOptions || { maxRetry: 3, retryIntervalMs: 2000, timeoutMs: 10000 },
            sessionKey: this._sessionKey,
        });
    }
}
class NanoclawChatStream extends LLMStream {
    nanoclawClient;
    _sessionKey;
    constructor(llmInstance, client, { chatCtx, toolCtx, connOptions, sessionKey, }) {
        super(llmInstance, { chatCtx, toolCtx, connOptions });
        this.nanoclawClient = client;
        this._sessionKey = sessionKey;
    }
    async run() {
        dbg.nanoclawStream('run() called');
        const messages = [];
        const chatCtx = this.chatCtx;
        const toolCtx = this.toolCtx;
        const connOptions = this.connOptions;
        dbg.nanoclawStream('chatCtx.items count: %d', chatCtx.items?.length ?? 0);
        for (const item of chatCtx.items) {
            dbg.nanoclawStream('item type=%s instanceof ChatMessage=%s FunctionCall=%s', item?.constructor?.name, item instanceof ChatMessageClass, item instanceof FunctionCallClass);
            if (item instanceof ChatMessageClass) {
                const msg = {
                    role: item.role,
                    content: item.textContent || undefined,
                };
                messages.push(msg);
            }
            else if (item instanceof FunctionCallClass) {
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
                }
                else {
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
            }
            else if ('type' in item && item.type === 'function_call_output') {
                // This is a tool response
                const output = item;
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
            const tools = toolCtx ? Object.values(toolCtx).map((tool) => ({
                type: 'function',
                function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters,
                },
            })) : undefined;
            dbg.nanoclawStream('converted %d messages, %d tools', messages.length, tools?.length ?? 0);
            if (messages.length > 0) {
                const lastMsg = messages[messages.length - 1];
                dbg.nanoclawStream('last message: role=%s content="%s"', lastMsg.role, (lastMsg.content || '').slice(0, 100));
            }
            // Extract session metadata from LiveKit context
            const session = extractNanoclawSession(chatCtx, connOptions);
            dbg.nanoclawStream('session: %O', session);
            dbg.nanoclawStream('sessionKey: %O', this._sessionKey);
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
                    const metaChunk = {
                        id: `meta-${Date.now()}`,
                        delta: {
                            role: 'assistant',
                            content: undefined,
                        },
                        // Store extended event in metadata (non-standard but useful)
                        ...chunk,
                    };
                    this.output.put(metaChunk);
                    continue;
                }
                const delta = chunk.choices?.[0]?.delta;
                if (!delta)
                    continue;
                // Map tool calls to FunctionCall format if present
                let toolCalls;
                if (delta.tool_calls) {
                    toolCalls = delta.tool_calls.map((tc) => new FunctionCallClass({
                        callId: tc.id || '',
                        name: tc.function?.name || '',
                        args: tc.function?.arguments || '',
                    }));
                }
                const chatChunk = {
                    id: chunk.id,
                    delta: {
                        role: delta.role || 'assistant',
                        content: delta.content || undefined,
                        toolCalls,
                    },
                };
                this.output.put(chatChunk);
            }
        }
        catch (error) {
            this.logger.error(`NanoclawChatStream error: ${error}`);
            throw error;
        }
        finally {
            this.output.close();
        }
    }
}
// Register with ganglia factory
registerGanglia('nanoclaw', async () => NanoclawLLM);
