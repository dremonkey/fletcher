import { OpenClawChatOptions, OpenClawChatResponse, OpenClawConfig, LiveKitSessionInfo, OpenClawSessionHeaders } from './types/index.js';
import type { SessionKey } from './session-routing.js';
/**
 * @deprecated Use resolveSessionKey() + SessionKey routing instead.
 * Generates a deterministic session ID from LiveKit session info.
 * Combines room SID and participant identity for unique session tracking.
 */
export declare function generateSessionId(session: LiveKitSessionInfo): string;
/**
 * @deprecated Use buildMetadataHeaders() + SessionKey routing instead.
 * Builds OpenClaw session headers from LiveKit session info.
 */
export declare function buildSessionHeaders(session: LiveKitSessionInfo): Partial<OpenClawSessionHeaders>;
/**
 * Builds supplementary metadata headers from LiveKit session info.
 * These are informational only — they do NOT affect routing.
 * Routing is determined by SessionKey (header or body.user).
 */
export declare function buildMetadataHeaders(session: LiveKitSessionInfo): Record<string, string>;
/**
 * Applies a SessionKey to the request headers and body.
 *
 * Routing rules per spec 08:
 * - owner  → header: x-openclaw-session-key: "main"
 * - guest  → body.user: "guest_{identity}"
 * - room   → body.user: "room_{room_name}"
 */
export declare function applySessionKey(sessionKey: SessionKey, headers: Record<string, string>, body: Record<string, any>): void;
export declare class OpenClawClient {
    private baseUrl;
    private apiKey;
    private model;
    private defaultSession?;
    private logger;
    constructor(config?: OpenClawConfig);
    /**
     * Returns the base URL for the OpenClaw Gateway.
     */
    getBaseUrl(): string;
    /**
     * Returns whether the client is configured with an API key.
     */
    isAuthenticated(): boolean;
    /**
     * Returns the current session info (default or from last request).
     */
    getDefaultSession(): LiveKitSessionInfo | undefined;
    /**
     * Updates the default session info for subsequent requests.
     */
    setDefaultSession(session: LiveKitSessionInfo): void;
    chat(options: OpenClawChatOptions): AsyncIterableIterator<OpenClawChatResponse>;
}
