import { llm, APIConnectOptions } from '@livekit/agents';
import { type GangliaLLM } from './factory.js';
import { type GangliaSessionInfo, type NanoclawConfig } from './ganglia-types.js';
import { type SessionKey } from './session-routing.js';
import { NanoclawClient } from './nanoclaw-client.js';
type ChatContext = llm.ChatContext;
type ToolContext = llm.ToolContext;
type ToolChoice = llm.ToolChoice;
declare const LLMBase: typeof llm.LLM;
declare const LLMStream: typeof llm.LLMStream;
/**
 * Extracts session info from ChatContext for Nanoclaw.
 * Similar to OpenClaw's extractSessionFromContext but simpler.
 */
export declare function extractNanoclawSession(chatCtx: ChatContext, connOptions?: APIConnectOptions & {
    sessionId?: string;
}): GangliaSessionInfo;
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
export declare class NanoclawLLM extends LLMBase implements GangliaLLM {
    private client;
    private _model;
    private _sessionKey?;
    private _historyMode;
    constructor(config: NanoclawConfig);
    /**
     * Returns the ganglia type identifier.
     */
    gangliaType(): string;
    label(): string;
    get model(): string;
    /**
     * Returns the underlying NanoclawClient for direct access if needed.
     */
    getClient(): NanoclawClient;
    /**
     * Sets the default session metadata for all subsequent chat requests.
     */
    setDefaultSession(session: GangliaSessionInfo): void;
    /**
     * Sets the session key for routing. This determines which backend
     * session the conversation routes to (owner/guest/room).
     */
    setSessionKey(sessionKey: SessionKey): void;
    /**
     * Returns the current session key, if set.
     */
    getSessionKey(): SessionKey | undefined;
    chat({ chatCtx, toolCtx, connOptions, }: {
        chatCtx: ChatContext;
        toolCtx?: ToolContext;
        connOptions?: APIConnectOptions;
        parallelToolCalls?: boolean;
        toolChoice?: ToolChoice;
        extraKwargs?: Record<string, unknown>;
    }): NanoclawChatStream;
}
declare class NanoclawChatStream extends LLMStream {
    private nanoclawClient;
    private _sessionKey?;
    private _historyMode;
    constructor(llmInstance: NanoclawLLM, client: NanoclawClient, { chatCtx, toolCtx, connOptions, sessionKey, historyMode, }: {
        chatCtx: ChatContext;
        toolCtx?: ToolContext;
        connOptions: APIConnectOptions;
        sessionKey?: SessionKey;
        historyMode: 'full' | 'latest';
    });
    protected run(): Promise<void>;
}
export {};
