import type { GangliaSessionInfo, NanoclawConfig } from './ganglia-types.js';
import type { OpenClawMessage, OpenClawChatResponse } from './types/index.js';

/**
 * Chat options for Nanoclaw API.
 */
export interface NanoclawChatOptions {
  messages: OpenClawMessage[];
  stream?: boolean;
  tools?: any[];
  tool_choice?: any;
  /** LiveKit session info for channel JID generation */
  session?: GangliaSessionInfo;
}

/**
 * Generates a Nanoclaw channel JID from session info.
 * Format: {prefix}:{participantIdentity}
 *
 * @example
 * generateChannelJid({ participantIdentity: 'user-123' }, 'lk') // => 'lk:user-123'
 */
export function generateChannelJid(
  session: GangliaSessionInfo,
  prefix: string = 'lk',
): string {
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
 * HTTP client for Nanoclaw's OpenAI-compatible API.
 *
 * Key differences from OpenClawClient:
 * - No authentication required (single-user, localhost)
 * - Uses X-Nanoclaw-Channel header instead of X-OpenClaw-* headers
 * - Simpler session management (JID-based)
 */
export class NanoclawClient {
  private baseUrl: string;
  private channelPrefix: string;
  private defaultSession?: GangliaSessionInfo;

  constructor(config: NanoclawConfig) {
    this.baseUrl = config.url || process.env.NANOCLAW_URL || 'http://localhost:18789';
    this.channelPrefix = config.channelPrefix || process.env.NANOCLAW_CHANNEL_PREFIX || 'lk';
  }

  /**
   * Returns the base URL for Nanoclaw API.
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Returns the channel prefix used for JID generation.
   */
  getChannelPrefix(): string {
    return this.channelPrefix;
  }

  /**
   * Returns the current default session info.
   */
  getDefaultSession(): GangliaSessionInfo | undefined {
    return this.defaultSession;
  }

  /**
   * Updates the default session info for subsequent requests.
   */
  setDefaultSession(session: GangliaSessionInfo): void {
    this.defaultSession = session;
  }

  /**
   * Streams chat completions from Nanoclaw.
   */
  async *chat(options: NanoclawChatOptions): AsyncIterableIterator<OpenClawChatResponse> {
    const controller = new AbortController();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Add channel JID header
    const session = options.session || this.defaultSession;
    if (session) {
      headers['X-Nanoclaw-Channel'] = generateChannelJid(session, this.channelPrefix);
    } else {
      // Fallback to unknown channel
      headers['X-Nanoclaw-Channel'] = `${this.channelPrefix}:unknown`;
    }

    const body: Record<string, any> = {
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

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

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
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine || trimmedLine === 'data: [DONE]') continue;
          if (trimmedLine.startsWith('data: ')) {
            try {
              const data = JSON.parse(trimmedLine.slice(6));

              // Handle extended event types (status, artifact)
              if (data.type === 'status' || data.type === 'artifact') {
                // Emit as-is for ToolInterceptor to handle
                yield data as any;
                continue;
              }

              // Standard chat completion chunk
              yield data as OpenClawChatResponse;
            } catch (e) {
              console.error('Error parsing JSON chunk:', trimmedLine);
            }
          }
        }
      }
    } catch (err) {
      controller.abort();
      throw err;
    } finally {
      reader.releaseLock();
    }
  }
}
