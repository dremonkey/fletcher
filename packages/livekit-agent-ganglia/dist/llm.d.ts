import { llm, APIConnectOptions } from '@livekit/agents';
import { type GangliaLLM } from './factory.js';
import { type GangliaSessionInfo } from './ganglia-types.js';
import { type SessionKey } from './session-routing.js';
import { OpenClawClient } from './client.js';
import { OpenClawConfig, LiveKitSessionInfo } from './types/index.js';
type ChatContext = llm.ChatContext;
type ToolContext = llm.ToolContext;
type ToolChoice = llm.ToolChoice;
declare const LLMBase: typeof llm.LLM;
declare const LLMStream: typeof llm.LLMStream;
/**
 * Extracts LiveKit session info from ChatContext and connection options.
 * This maps LiveKit identifiers to OpenClaw session headers for persistent state.
 */
export declare function extractSessionFromContext(chatCtx: ChatContext, connOptions?: APIConnectOptions & {
    sessionId?: string;
}): LiveKitSessionInfo;
export declare class OpenClawLLM extends LLMBase implements GangliaLLM {
    private client;
    private _model;
    private _sessionKey?;
    private _onPondering?;
    private _onContent?;
    private _nextStreamSeq;
    constructor(config?: OpenClawConfig);
    /**
     * Returns the ganglia type identifier.
     */
    gangliaType(): string;
    label(): string;
    get model(): string;
    /**
     * Returns the underlying OpenClawClient for direct access if needed.
     */
    getClient(): OpenClawClient;
    /**
     * Sets the default session metadata for all subsequent chat requests.
     */
    setDefaultSession(session: LiveKitSessionInfo | GangliaSessionInfo): void;
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
    }): OpenClawChatStream;
}
declare class OpenClawChatStream extends LLMStream {
    private openclawClient;
    private _sessionKey?;
    private _onPondering?;
    private _onContent?;
    private _streamId;
    constructor(llmInstance: OpenClawLLM, client: OpenClawClient, { chatCtx, toolCtx, connOptions, sessionKey, onPondering, onContent, streamId, }: {
        chatCtx: ChatContext;
        toolCtx?: ToolContext;
        connOptions: APIConnectOptions;
        sessionKey?: SessionKey;
        onPondering?: (phrase: string | null, streamId: string) => void;
        onContent?: (delta: string, fullText: string, streamId: string) => void;
        streamId: string;
    });
    protected run(): Promise<void>;
}
export {};
