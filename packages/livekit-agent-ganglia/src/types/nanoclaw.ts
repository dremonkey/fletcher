/**
 * Nanoclaw-specific types for the HTTP/SSE chat completions protocol.
 *
 * These types are kept for the Nanoclaw backend which still uses
 * the OpenAI-compatible HTTP API. The OpenClaw HTTP backend has been
 * replaced by the ACP backend.
 */

export interface OpenClawMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content?: string;
  tool_calls?: OpenClawToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface OpenClawToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface OpenClawChatResponse {
  id: string;
  choices: {
    delta: {
      role?: string;
      content?: string;
      tool_calls?: OpenClawToolCallDelta[];
    };
    finish_reason?: string;
  }[];
}

export interface OpenClawToolCallDelta {
  index: number;
  id?: string;
  type?: 'function';
  function?: {
    name?: string;
    arguments?: string;
  };
}
