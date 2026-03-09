import {
  OpenClawChatOptions,
  OpenClawChatResponse,
  OpenClawConfig,
  LiveKitSessionInfo,
  OpenClawSessionHeaders,
  AuthenticationError,
  SessionError,
  OpenResponsesError,
  RateLimitError,
} from './types/index.js';
import type {
  OpenClawRespondOptions,
  OpenResponsesEvent,
  OpenResponsesEventType,
} from './types/openresponses.js';
import type { SessionKey } from './session-routing.js';
import { type Logger, noopLogger, dbg } from './logger.js';

/**
 * @deprecated Use resolveSessionKey() + SessionKey routing instead.
 * Generates a deterministic session ID from LiveKit session info.
 * Combines room SID and participant identity for unique session tracking.
 */
export function generateSessionId(session: LiveKitSessionInfo): string {
  // Priority: customSessionId > roomSid+participantIdentity > roomName+participantIdentity > roomName > roomSid
  if (session.customSessionId) {
    return session.customSessionId;
  }

  const parts: string[] = [];

  // Prefer SID over name for uniqueness (SIDs are unique per instance)
  if (session.roomSid) {
    parts.push(session.roomSid);
  } else if (session.roomName) {
    parts.push(session.roomName);
  }

  if (session.participantIdentity) {
    parts.push(session.participantIdentity);
  } else if (session.participantSid) {
    parts.push(session.participantSid);
  }

  if (parts.length === 0) {
    // Fallback to a random session if no identifiers provided
    return `session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  return parts.join(':');
}

/**
 * @deprecated Use buildMetadataHeaders() + SessionKey routing instead.
 * Builds OpenClaw session headers from LiveKit session info.
 */
export function buildSessionHeaders(session: LiveKitSessionInfo): Partial<OpenClawSessionHeaders> {
  const headers: Partial<OpenClawSessionHeaders> = {
    'X-OpenClaw-Session-Id': generateSessionId(session),
  };

  if (session.roomSid) {
    headers['X-OpenClaw-Room-SID'] = session.roomSid;
  }
  if (session.roomName) {
    headers['X-OpenClaw-Room-Name'] = session.roomName;
  }
  if (session.participantIdentity) {
    headers['X-OpenClaw-Participant-Identity'] = session.participantIdentity;
  }
  if (session.participantSid) {
    headers['X-OpenClaw-Participant-SID'] = session.participantSid;
  }

  return headers;
}

/**
 * Builds supplementary metadata headers from LiveKit session info.
 * These are informational only — they do NOT affect routing.
 * Routing is determined by SessionKey (header or body.user).
 */
export function buildMetadataHeaders(session: LiveKitSessionInfo): Record<string, string> {
  const headers: Record<string, string> = {};

  if (session.roomSid) {
    headers['X-OpenClaw-Room-SID'] = session.roomSid;
  }
  if (session.roomName) {
    headers['X-OpenClaw-Room-Name'] = session.roomName;
  }
  if (session.participantIdentity) {
    headers['X-OpenClaw-Participant-Identity'] = session.participantIdentity;
  }
  if (session.participantSid) {
    headers['X-OpenClaw-Participant-SID'] = session.participantSid;
  }

  return headers;
}

/**
 * Applies a SessionKey to the request headers and body.
 *
 * Routing rules per spec 08:
 * - owner  → header: x-openclaw-session-key: "main"
 * - guest  → body.user: "guest_{identity}"
 * - room   → body.user: "room_{room_name}"
 */
export function applySessionKey(
  sessionKey: SessionKey,
  headers: Record<string, string>,
  body: Record<string, any>,
): void {
  if (sessionKey.type === 'owner') {
    headers['x-openclaw-session-key'] = sessionKey.key;
  } else {
    // guest or room — use body.user
    body.user = sessionKey.key;
  }
}

export class OpenClawClient {
  private baseUrl: string;
  private apiKey: string;
  private model: string;
  private defaultSession?: LiveKitSessionInfo;
  private logger: Logger;

  constructor(config: OpenClawConfig = {}) {
    this.baseUrl = config.baseUrl || process.env.OPENCLAW_GATEWAY_URL || 'http://localhost:8080';
    this.apiKey = config.apiKey || process.env.OPENCLAW_API_KEY || '';
    this.model = config.model || 'openclaw-gateway';
    this.defaultSession = config.defaultSession;
    this.logger = config.logger || noopLogger;
  }

  /**
   * Returns the base URL for the OpenClaw Gateway.
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Returns whether the client is configured with an API key.
   */
  isAuthenticated(): boolean {
    return this.apiKey.length > 0;
  }

  /**
   * Returns the current session info (default or from last request).
   */
  getDefaultSession(): LiveKitSessionInfo | undefined {
    return this.defaultSession;
  }

  /**
   * Updates the default session info for subsequent requests.
   */
  setDefaultSession(session: LiveKitSessionInfo): void {
    this.defaultSession = session;
  }

  /**
   * Returns the configured model name.
   */
  getModel(): string {
    return this.model;
  }

  /**
   * Sends a request to the OpenResponses `/v1/responses` endpoint and yields
   * raw SSE events as they arrive. This is the low-level method; most consumers
   * should prefer `respondAsChat()` which maps events to the ChatResponse format.
   *
   * Yields `OpenResponsesEvent` objects with typed `event` and JSON `data` fields.
   * The generator returns when the stream completes (either `[DONE]` sentinel or
   * stream end). Throws on HTTP errors or `response.failed` events.
   */
  async *respond(options: OpenClawRespondOptions): AsyncIterableIterator<OpenResponsesEvent> {
    const controller = new AbortController();
    const fetchSignal = options.signal
      ? AbortSignal.any([controller.signal, options.signal])
      : controller.signal;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Add authentication header (same as chat())
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const body: Record<string, any> = {
      model: this.model,
      input: options.input,
      stream: options.stream !== false, // default true
    };

    if (options.instructions) {
      body.instructions = options.instructions;
    }
    if (options.tools) {
      body.tools = options.tools;
    }
    if (options.tool_choice) {
      body.tool_choice = options.tool_choice;
    }

    // Session routing: sessionKey > user field > session-derived user
    const session = options.session || this.defaultSession;

    if (options.sessionKey) {
      applySessionKey(options.sessionKey, headers, body);
      if (session) {
        Object.assign(headers, buildMetadataHeaders(session));
      }
    } else if (options.user) {
      body.user = options.user;
      if (session) {
        Object.assign(headers, buildMetadataHeaders(session));
      }
    } else if (session?.participantIdentity) {
      body.user = `fletcher_${session.participantIdentity}`;
      Object.assign(headers, buildMetadataHeaders(session));
    }

    const url = `${this.baseUrl}/v1/responses`;
    dbg.openresponses('POST %s input=%s hasTools=%s sessionKey=%s',
      url,
      typeof options.input === 'string' ? `"${options.input.slice(0, 60)}"` : `[${(options.input as any[]).length} items]`,
      !!(options.tools && options.tools.length > 0),
      options.sessionKey?.type ?? 'none',
    );

    const fetchStart = performance.now();
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: fetchSignal,
      });
    } catch (fetchError) {
      if (options.signal?.aborted && fetchError instanceof DOMException && fetchError.name === 'AbortError') {
        dbg.openresponses('fetch aborted by external signal (graceful cancellation)');
        return;
      }
      this.logger.error(`OpenClawClient.respond() fetch failed for ${url}: ${fetchError}`);
      throw fetchError;
    }

    const responseMs = Math.round(performance.now() - fetchStart);
    dbg.openresponses('response %d %s (fetchLatency=%dms)', response.status, response.statusText, responseMs);

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');

      if (response.status === 401) {
        throw new AuthenticationError(
          `Authentication failed: ${errorText}`,
          'UNAUTHORIZED',
          401,
        );
      }

      if (response.status === 403) {
        throw new AuthenticationError(
          `Access forbidden: ${errorText}`,
          'FORBIDDEN',
          403,
        );
      }

      if (response.status === 429) {
        const retryAfterHeader = response.headers.get('Retry-After');
        const retryAfter = retryAfterHeader ? parseInt(retryAfterHeader, 10) : undefined;
        throw new RateLimitError(
          `Rate limit exceeded: ${errorText}`,
          isNaN(retryAfter as number) ? undefined : retryAfter,
        );
      }

      if (response.status === 440 || errorText.toLowerCase().includes('session expired')) {
        const sid = options.sessionKey?.key || options.user || 'unknown';
        throw new SessionError(
          `Session expired: ${errorText}`,
          sid,
          'expired',
        );
      }

      throw new OpenResponsesError(
        `HTTP ${response.status}: ${errorText}`,
        'http_error',
        response.status.toString(),
      );
    }

    if (!response.body) {
      throw new OpenResponsesError('No response body', 'http_error', 'no_body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentEventType: string = '';
    let eventCount = 0;
    let firstEventAt: number | undefined;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();

          // Empty line = end of SSE event block (reset)
          if (!trimmed) {
            currentEventType = '';
            continue;
          }

          // End of stream sentinel
          if (trimmed === 'data: [DONE]') {
            dbg.openresponses('received [DONE] sentinel');
            return;
          }

          // SSE event type line
          if (trimmed.startsWith('event: ')) {
            currentEventType = trimmed.slice(7);
            continue;
          }

          // SSE data line
          if (trimmed.startsWith('data: ')) {
            try {
              const data = JSON.parse(trimmed.slice(6));
              eventCount++;
              if (!firstEventAt) {
                firstEventAt = performance.now();
                dbg.openresponses('timing: fetchStart->firstEvent=%dms', Math.round(firstEventAt - fetchStart));
              }

              const event: OpenResponsesEvent = {
                event: (currentEventType || 'message') as OpenResponsesEventType,
                data,
              };

              // Log lifecycle events
              if (event.event === 'response.created') {
                dbg.openresponses('response created: id=%s', data.id);
              } else if (event.event === 'response.completed') {
                dbg.openresponses('response completed: usage=%j', data.usage);
              } else if (event.event === 'response.failed') {
                dbg.openresponses('response failed: error=%j', data.error);
                this.logger.error(`OpenResponses response.failed: ${data.error?.message || 'unknown error'}`);
              }

              yield event;
            } catch (e) {
              this.logger.warn(`OpenResponses: failed to parse SSE data: ${trimmed}`);
            }
          }
        }
      }
    } catch (err) {
      if (options.signal?.aborted && err instanceof DOMException && err.name === 'AbortError') {
        dbg.openresponses('stream read aborted by external signal (graceful cancellation)');
        return;
      }
      controller.abort();
      throw err;
    } finally {
      const streamEndMs = Math.round(performance.now() - fetchStart);
      dbg.openresponses('timing: totalStreamDuration=%dms events=%d', streamEndMs, eventCount);
      reader.releaseLock();
    }
  }

  /**
   * Wrapper around `respond()` that maps OpenResponses events into the
   * `OpenClawChatResponse` format expected by the existing LLMStream pipeline.
   *
   * This allows consumers that use the Chat Completions interface to
   * transparently switch to the OpenResponses backend.
   *
   * Mapping:
   * - `response.output_text.delta` -> choices[0].delta.content
   * - `response.output_text.done`  -> choices[0].finish_reason = 'stop'
   * - `response.output_item.done` (function_call) -> choices[0].delta.tool_calls
   * - `response.failed`           -> throws OpenResponsesError
   * - lifecycle events             -> skipped (logged by respond())
   */
  async *respondAsChat(options: OpenClawRespondOptions): AsyncIterableIterator<OpenClawChatResponse> {
    let responseId = '';

    for await (const event of this.respond(options)) {
      switch (event.event) {
        case 'response.created':
          responseId = event.data.id || '';
          break;

        case 'response.output_text.delta':
          yield {
            id: responseId,
            choices: [{
              delta: { content: event.data.delta },
            }],
          };
          break;

        case 'response.output_text.done':
          // The final text is complete — emit a stop signal
          yield {
            id: responseId,
            choices: [{
              delta: {},
              finish_reason: 'stop',
            }],
          };
          break;

        case 'response.output_item.done': {
          // Handle function_call items — map to tool_calls delta
          const item = event.data.item || event.data;
          if (item.type === 'function_call' && item.name && item.call_id) {
            yield {
              id: responseId,
              choices: [{
                delta: {
                  tool_calls: [{
                    index: 0,
                    id: item.call_id,
                    type: 'function',
                    function: {
                      name: item.name,
                      arguments: item.arguments || '{}',
                    },
                  }],
                },
              }],
            };
          }
          break;
        }

        case 'response.failed': {
          const error = event.data.error || { message: 'Unknown error', type: 'server_error' };
          throw new OpenResponsesError(
            error.message,
            error.type,
            error.code,
          );
        }

        // Lifecycle events: logged by respond(), not mapped to chat deltas
        case 'response.in_progress':
        case 'response.completed':
        case 'response.output_item.added':
        case 'response.content_part.added':
        case 'response.content_part.done':
          break;

        default:
          dbg.openresponses('unmapped event: %s', event.event);
          break;
      }
    }
  }

  async *chat(options: OpenClawChatOptions): AsyncIterableIterator<OpenClawChatResponse> {
    const controller = new AbortController();
    const fetchSignal = options.signal
      ? AbortSignal.any([controller.signal, options.signal])
      : controller.signal;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Add authentication header
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const body: Record<string, any> = {
      model: this.model,
      messages: options.messages,
      stream: true,
    };

    if (options.tools) {
      body.tools = options.tools;
    }
    if (options.tool_choice) {
      body.tool_choice = options.tool_choice;
    }

    // Session routing: SessionKey takes priority, then legacy fallback
    const session = options.session || this.defaultSession;

    if (options.sessionKey) {
      // New routing: apply session key to headers/body per spec 08
      applySessionKey(options.sessionKey, headers, body);

      // Add supplementary metadata headers (informational, not routing)
      if (session) {
        Object.assign(headers, buildMetadataHeaders(session));
      }
    } else if (session) {
      // Legacy fallback: use old session headers
      const sessionHeaders = buildSessionHeaders(session);
      Object.assign(headers, sessionHeaders);
      const sessionId = generateSessionId(session);
      body.session_id = sessionId;
    } else if (options.sessionId) {
      // Legacy support: use sessionId directly as the session header
      headers['X-OpenClaw-Session-Id'] = options.sessionId;
      body.session_id = options.sessionId;
    }

    const url = `${this.baseUrl}/v1/chat/completions`;
    dbg.openclawClient('POST %s msgCount=%d hasTools=%s sessionKey=%s',
      url, options.messages.length,
      !!(options.tools && options.tools.length > 0),
      options.sessionKey?.type ?? 'none',
    );

    const fetchStart = performance.now();
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: fetchSignal,
      });
    } catch (fetchError) {
      // If the external signal triggered the abort, return cleanly — this is
      // a graceful consumer-initiated cancellation (e.g. LLMStream.close()).
      if (options.signal?.aborted && fetchError instanceof DOMException && fetchError.name === 'AbortError') {
        dbg.openclawClient('fetch aborted by external signal (graceful cancellation)');
        return;
      }
      this.logger.error(`OpenClawClient fetch failed for ${url}: ${fetchError}`);
      throw fetchError;
    }

    const responseMs = Math.round(performance.now() - fetchStart);
    dbg.openclawClient('response %d %s (fetchLatency=%dms)', response.status, response.statusText, responseMs);

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');

      // Handle authentication errors specifically
      if (response.status === 401) {
        throw new AuthenticationError(
          `Authentication failed: ${errorText}`,
          'UNAUTHORIZED',
          401,
        );
      }

      if (response.status === 403) {
        throw new AuthenticationError(
          `Access forbidden: ${errorText}`,
          'FORBIDDEN',
          403,
        );
      }

      // Handle session-related errors
      if (response.status === 440 || errorText.toLowerCase().includes('session expired')) {
        // Use the routing key if available, otherwise fall back to legacy session ID
        const sid = options.sessionKey?.key
          || (session ? generateSessionId(session) : options.sessionId || 'unknown');
        throw new SessionError(
          `Session expired: ${errorText}`,
          sid,
          'expired',
        );
      }

      throw new Error(`OpenClaw API error (${response.status}): ${errorText}`);
    }

    if (!response.body) {
      throw new Error('No response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let firstChunkAt: number | undefined;
    let chunkCount = 0;

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
              chunkCount++;
              if (!firstChunkAt) {
                firstChunkAt = performance.now();
                dbg.openclawClient('timing: fetchStart→firstChunk=%dms', Math.round(firstChunkAt - fetchStart));
              }
              yield data as OpenClawChatResponse;
            } catch (e) {
              this.logger.warn(`Error parsing JSON chunk: ${trimmedLine}`);
            }
          }
        }
      }
    } catch (err) {
      // If the external signal triggered the abort during streaming, return cleanly.
      if (options.signal?.aborted && err instanceof DOMException && err.name === 'AbortError') {
        dbg.openclawClient('stream read aborted by external signal (graceful cancellation)');
        return;
      }
      controller.abort();
      throw err;
    } finally {
      const streamEndMs = Math.round(performance.now() - fetchStart);
      dbg.openclawClient('timing: totalStreamDuration=%dms chunks=%d', streamEndMs, chunkCount);
      reader.releaseLock();
    }
  }
}
