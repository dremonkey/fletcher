// Example implementation for src/api/types.ts

/**
 * Status event types for voice UX feedback.
 * These are sent during long-running operations to indicate what's happening.
 */
export interface StatusEvent {
  type: 'status';
  action: StatusAction;
  detail?: string;
  file?: string;
  query?: string;
}

export type StatusAction =
  | 'thinking'
  | 'searching_files'
  | 'reading_file'
  | 'writing_file'
  | 'web_search'
  | 'executing_command'
  | 'analyzing';

/**
 * Artifact event types for visual content (not spoken).
 * These are sent to the Flutter app via LiveKit data channel.
 */
export interface ArtifactEvent {
  type: 'artifact';
  artifact_type: ArtifactType;
  file?: string;
  path?: string;
  content?: string;
  diff?: string;
  language?: string;
  query?: string;
  results?: unknown[];
}

export type ArtifactType =
  | 'diff'
  | 'code'
  | 'file'
  | 'search_results'
  | 'image';

/**
 * Content event (standard OpenAI delta format).
 * This content is spoken via TTS.
 */
export interface ContentEvent {
  type: 'content';
  delta: string;
}

/**
 * Streaming callbacks for conversation runner.
 */
export interface StreamCallbacks {
  onStatus: (action: StatusAction, detail?: string) => Promise<void>;
  onArtifact: (artifactType: ArtifactType, data: Record<string, unknown>) => Promise<void>;
  onContent: (delta: string) => Promise<void>;
  onToolCall: (name: string, args: Record<string, unknown>) => Promise<void>;
}

/**
 * OpenAI-compatible chat message format.
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * OpenAI-compatible chat completion request.
 */
export interface ChatCompletionRequest {
  model?: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
}
