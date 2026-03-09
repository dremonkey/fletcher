/**
 * OpenResponses API Types
 *
 * Type definitions for the OpenClaw native `/v1/responses` endpoint.
 * This API provides item-based streaming with granular SSE events,
 * structured errors, and lifecycle visibility.
 *
 * See: tasks/18-openresponses-api/001-technical-spec.md
 */

// ---------------------------------------------------------------------------
// SSE Event Types
// ---------------------------------------------------------------------------

/** All known OpenResponses SSE event types. */
export type OpenResponsesEventType =
  | 'response.created'
  | 'response.in_progress'
  | 'response.output_item.added'
  | 'response.content_part.added'
  | 'response.output_text.delta'
  | 'response.output_text.done'
  | 'response.content_part.done'
  | 'response.output_item.done'
  | 'response.completed'
  | 'response.failed';

/**
 * A parsed SSE event from the OpenResponses stream.
 * The `event` field identifies the event type; `data` is the JSON-parsed payload.
 */
export interface OpenResponsesEvent {
  event: OpenResponsesEventType;
  data: any;
}

// ---------------------------------------------------------------------------
// Event Data Payloads
// ---------------------------------------------------------------------------

/** Payload for `response.created` events. */
export interface ResponseCreatedData {
  id: string;
  object: string;
  model: string;
  status: string;
}

/** Payload for `response.output_text.delta` events. */
export interface OutputTextDeltaData {
  /** The incremental text chunk for this delta. */
  delta: string;
  /** The accumulated text so far (running total). */
  text: string;
}

/** Payload for `response.output_text.done` events. */
export interface OutputTextDoneData {
  /** The finalized full text of this content part. */
  text: string;
}

/** Payload for `response.output_item.added` events. */
export interface OutputItemAddedData {
  item: {
    id: string;
    type: 'message' | 'function_call' | 'function_call_output';
    role?: string;
    status?: string;
  };
}

/** Payload for `response.output_item.done` events. */
export interface OutputItemDoneData {
  item: {
    id: string;
    type: 'message' | 'function_call' | 'function_call_output';
    role?: string;
    status?: string;
    content?: Array<{
      type: string;
      text?: string;
    }>;
    /** For function_call items */
    name?: string;
    call_id?: string;
    arguments?: string;
  };
}

/** Payload for `response.content_part.added` events. */
export interface ContentPartAddedData {
  part: {
    type: 'text' | 'reasoning';
    text?: string;
  };
}

/** Payload for `response.content_part.done` events. */
export interface ContentPartDoneData {
  part: {
    type: 'text' | 'reasoning';
    text?: string;
  };
}

/** Payload for `response.completed` events. */
export interface ResponseCompletedData {
  id: string;
  status: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
}

/** Payload for `response.failed` events. */
export interface ResponseFailedData {
  error: {
    type: string;
    message: string;
    code?: string;
  };
}

// ---------------------------------------------------------------------------
// Request Types
// ---------------------------------------------------------------------------

/**
 * An input item for the OpenResponses API.
 * Can be a message (system/user/assistant) or function call output.
 */
export interface InputItem {
  type: 'message' | 'function_call_output';
  role?: 'system' | 'user' | 'assistant';
  content?: Array<{ type: 'text'; text: string }> | string;
  /** For function_call_output items */
  call_id?: string;
  output?: string;
}

/**
 * Options for the `respond()` method on OpenClawClient.
 */
export interface OpenClawRespondOptions {
  /** The input: a simple string, or an array of InputItems for multi-turn. */
  input: string | InputItem[];
  /** System-level instructions (replaces the system message). */
  instructions?: string;
  /** Tool definitions. */
  tools?: any[];
  /** Tool choice strategy. */
  tool_choice?: any;
  /** Whether to stream the response (default: true). */
  stream?: boolean;
  /** User identifier for session routing (derives stable session key). */
  user?: string;
  /** Resolved session key for routing (takes priority over user field). */
  sessionKey?: import('../session-routing.js').SessionKey;
  /** LiveKit session info for metadata headers. */
  session?: import('../types/index.js').LiveKitSessionInfo;
  /** External abort signal for cancellation. */
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Error Types
// ---------------------------------------------------------------------------

/**
 * Base error class for OpenResponses API errors.
 * Provides structured error information including type, code, and retry guidance.
 */
export class OpenResponsesError extends Error {
  constructor(
    message: string,
    public readonly type: string,
    public readonly code?: string,
    public readonly retryAfter?: number,
  ) {
    super(message);
    this.name = 'OpenResponsesError';
  }
}

/**
 * Error thrown when the API returns a rate limit (429) response.
 * Includes `retryAfter` (seconds) extracted from the Retry-After header.
 */
export class RateLimitError extends OpenResponsesError {
  constructor(message: string, retryAfter?: number) {
    super(message, 'rate_limit_error', 'rate_limit_exceeded', retryAfter);
    this.name = 'RateLimitError';
  }
}
