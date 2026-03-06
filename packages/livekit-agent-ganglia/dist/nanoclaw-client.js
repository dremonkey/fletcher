import { noopLogger, dbg } from './logger.js';
/**
 * Generates a Nanoclaw channel JID from session info.
 * Format: {prefix}:{participantIdentity}
 *
 * @example
 * generateChannelJid({ participantIdentity: 'user-123' }, 'lk') // => 'lk:user-123'
 */
export function generateChannelJid(session, prefix = 'lk') {
    // Priority: participantIdentity > customSessionId > roomName:participantSid > fallback
    if (session.participantIdentity) {
        return `${prefix}:${session.participantIdentity}`;
    }
    if (session.customSessionId) {
        return `${prefix}:${session.customSessionId}`;
    }
    if (session.roomName && session.participantSid) {
        return `${prefix}:${session.roomName}:${session.participantSid}`;
    }
    if (session.roomSid && session.participantSid) {
        return `${prefix}:${session.roomSid}:${session.participantSid}`;
    }
    // Fallback: generate a random identifier
    return `${prefix}:session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
/**
 * Maps a SessionKey to a Nanoclaw channel value.
 *
 * Routing rules per spec 08:
 * - owner → "main" (or omitted for default session)
 * - guest → "guest:{identity}"
 * - room  → "room:{room_name}"
 */
export function sessionKeyToChannel(sessionKey) {
    if (sessionKey.type === 'owner') {
        return 'main';
    }
    // Split on first underscore only: guest_user_name → guest:user_name
    const idx = sessionKey.key.indexOf('_');
    if (idx === -1)
        return sessionKey.key;
    return sessionKey.key.slice(0, idx) + ':' + sessionKey.key.slice(idx + 1);
}
/**
 * HTTP client for Nanoclaw's OpenAI-compatible API.
 *
 * Key differences from OpenClawClient:
 * - No authentication required (single-user, localhost)
 * - Uses X-Nanoclaw-Channel header instead of X-OpenClaw-* headers
 * - Simpler session management (JID-based)
 */
export class NanoclawClient {
    baseUrl;
    channelPrefix;
    defaultSession;
    logger;
    constructor(config) {
        this.baseUrl = config.url || process.env.NANOCLAW_URL || 'http://localhost:18789';
        this.channelPrefix = config.channelPrefix || process.env.NANOCLAW_CHANNEL_PREFIX || 'lk';
        this.logger = config.logger || noopLogger;
    }
    /**
     * Returns the base URL for Nanoclaw API.
     */
    getBaseUrl() {
        return this.baseUrl;
    }
    /**
     * Returns the channel prefix used for JID generation.
     */
    getChannelPrefix() {
        return this.channelPrefix;
    }
    /**
     * Returns the current default session info.
     */
    getDefaultSession() {
        return this.defaultSession;
    }
    /**
     * Updates the default session info for subsequent requests.
     */
    setDefaultSession(session) {
        this.defaultSession = session;
    }
    /**
     * Streams chat completions from Nanoclaw.
     */
    async *chat(options) {
        const controller = new AbortController();
        const headers = {
            'Content-Type': 'application/json',
        };
        // Session routing: SessionKey takes priority, then legacy JID fallback
        if (options.sessionKey) {
            headers['X-Nanoclaw-Channel'] = sessionKeyToChannel(options.sessionKey);
        }
        else {
            const session = options.session || this.defaultSession;
            if (session) {
                headers['X-Nanoclaw-Channel'] = generateChannelJid(session, this.channelPrefix);
            }
            else {
                headers['X-Nanoclaw-Channel'] = `${this.channelPrefix}:unknown`;
            }
        }
        const body = {
            model: 'nanoclaw',
            messages: options.messages,
            stream: options.stream ?? true,
        };
        if (options.tools) {
            body.tools = options.tools;
        }
        if (options.tool_choice) {
            body.tool_choice = options.tool_choice;
        }
        const url = `${this.baseUrl}/v1/chat/completions`;
        dbg.nanoclawClient('POST %s msgCount=%d hasTools=%s channel=%s', url, options.messages.length, !!(options.tools && options.tools.length > 0), headers['X-Nanoclaw-Channel']);
        let response;
        try {
            response = await fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
                signal: controller.signal,
            });
        }
        catch (fetchError) {
            this.logger.error(`NanoclawClient fetch failed for ${url}: ${fetchError}`);
            throw fetchError;
        }
        dbg.nanoclawClient('response %d %s', response.status, response.statusText);
        if (!response.ok) {
            const errorText = await response.text().catch(() => 'Unknown error');
            throw new Error(`Nanoclaw API error (${response.status}): ${errorText}`);
        }
        if (!response.body) {
            throw new Error('No response body');
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (const line of lines) {
                    const trimmedLine = line.trim();
                    if (!trimmedLine || trimmedLine === 'data: [DONE]')
                        continue;
                    if (trimmedLine.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(trimmedLine.slice(6));
                            // Handle extended event types (status, artifact)
                            if (data.type === 'status' || data.type === 'artifact') {
                                // Emit as-is for ToolInterceptor to handle
                                yield data;
                                continue;
                            }
                            // Standard chat completion chunk
                            yield data;
                        }
                        catch (e) {
                            this.logger.warn(`Error parsing JSON chunk: ${trimmedLine}`);
                        }
                    }
                }
            }
        }
        catch (err) {
            controller.abort();
            throw err;
        }
        finally {
            reader.releaseLock();
        }
    }
}
