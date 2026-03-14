import type { GangliaSessionInfo, NanoclawConfig } from './ganglia-types.js';
import type { OpenClawMessage, OpenClawChatResponse } from './types/nanoclaw.js';
import type { SessionKey } from './session-routing.js';
/**
 * Chat options for Nanoclaw API.
 */
export interface NanoclawChatOptions {
    messages: OpenClawMessage[];
    stream?: boolean;
    tools?: any[];
    tool_choice?: any;
    /** LiveKit session info for channel JID generation (legacy) */
    session?: GangliaSessionInfo;
    /** Resolved session key for routing. Takes priority over session for channel header. */
    sessionKey?: SessionKey;
    /** External abort signal — when aborted, the in-flight fetch is cancelled immediately. */
    signal?: AbortSignal;
}
/**
 * Generates a Nanoclaw channel JID from session info.
 * Format: {prefix}:{participantIdentity}
 *
 * @example
 * generateChannelJid({ participantIdentity: 'user-123' }, 'lk') // => 'lk:user-123'
 */
export declare function generateChannelJid(session: GangliaSessionInfo, prefix?: string): string;
/**
 * Maps a SessionKey to a Nanoclaw channel value.
 *
 * Routing rules per spec 08:
 * - owner → "main" (or omitted for default session)
 * - guest → "guest:{identity}"
 * - room  → "room:{room_name}"
 */
export declare function sessionKeyToChannel(sessionKey: SessionKey): string;
/**
 * HTTP client for Nanoclaw's OpenAI-compatible API.
 *
 * Key differences from OpenClawClient:
 * - No authentication required (single-user, localhost)
 * - Uses X-Nanoclaw-Channel header instead of X-OpenClaw-* headers
 * - Simpler session management (JID-based)
 */
export declare class NanoclawClient {
    private baseUrl;
    private channelPrefix;
    private defaultSession?;
    private logger;
    constructor(config: NanoclawConfig);
    /**
     * Returns the base URL for Nanoclaw API.
     */
    getBaseUrl(): string;
    /**
     * Returns the channel prefix used for JID generation.
     */
    getChannelPrefix(): string;
    /**
     * Returns the current default session info.
     */
    getDefaultSession(): GangliaSessionInfo | undefined;
    /**
     * Updates the default session info for subsequent requests.
     */
    setDefaultSession(session: GangliaSessionInfo): void;
    /**
     * Streams chat completions from Nanoclaw.
     */
    chat(options: NanoclawChatOptions): AsyncIterableIterator<OpenClawChatResponse>;
}
