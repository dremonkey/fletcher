/**
 * Extended event types for voice UX.
 *
 * These events provide feedback during long-running operations
 * and visual artifacts for coding sessions.
 */

/**
 * Status event actions - what the agent is currently doing.
 */
export type StatusAction =
  | 'thinking'
  | 'searching_files'
  | 'reading_file'
  | 'writing_file'
  | 'editing_file'
  | 'web_search'
  | 'executing_command'
  | 'analyzing';

/**
 * Status event - provides feedback during operations.
 * Sent via data channel to show progress in UI.
 */
export interface StatusEvent {
  type: 'status';
  action: StatusAction;
  /** Additional context (file path, search query, etc.) */
  detail?: string;
  /** Timestamp when the action started */
  startedAt?: number;
}

/**
 * Artifact types that can be displayed visually.
 */
export type ArtifactType =
  | 'diff'
  | 'code'
  | 'markdown'
  | 'file'
  | 'search_results'
  | 'error';

/**
 * Base artifact event structure.
 */
export interface BaseArtifact {
  type: 'artifact';
  artifact_type: ArtifactType;
  /** Optional title for the artifact */
  title?: string;
}

/**
 * Diff artifact - shows code changes.
 */
export interface DiffArtifact extends BaseArtifact {
  artifact_type: 'diff';
  /** File path being modified */
  file: string;
  /** Unified diff content */
  diff: string;
}

/**
 * Code artifact - displays a code block.
 */
export interface CodeArtifact extends BaseArtifact {
  artifact_type: 'code';
  /** Programming language for syntax highlighting */
  language?: string;
  /** Code content */
  content: string;
  /** Optional file path */
  file?: string;
  /** Starting line number (for context) */
  startLine?: number;
}

/**
 * Markdown artifact - displays rich text content.
 */
export interface MarkdownArtifact extends BaseArtifact {
  artifact_type: 'markdown';
  /** Markdown content */
  content: string;
  /** Optional file path */
  path?: string;
}

/**
 * File artifact - displays file contents.
 */
export interface FileArtifact extends BaseArtifact {
  artifact_type: 'file';
  /** File path */
  path: string;
  /** File content */
  content: string;
  /** Programming language for syntax highlighting */
  language?: string;
}

/**
 * Search results artifact - displays search matches.
 */
export interface SearchResultsArtifact extends BaseArtifact {
  artifact_type: 'search_results';
  /** Search query */
  query: string;
  /** Search results */
  results: Array<{
    file: string;
    line: number;
    content: string;
  }>;
}

/**
 * Error artifact - displays an error message.
 */
export interface ErrorArtifact extends BaseArtifact {
  artifact_type: 'error';
  /** Error message */
  message: string;
  /** Optional stack trace */
  stack?: string;
}

/**
 * Union of all artifact types.
 */
export type ArtifactEvent =
  | DiffArtifact
  | CodeArtifact
  | MarkdownArtifact
  | FileArtifact
  | SearchResultsArtifact
  | ErrorArtifact;

/**
 * Content event - spoken via TTS.
 * This is the standard content from the LLM response.
 */
export interface ContentEvent {
  type: 'content';
  delta: string;
}

/**
 * Union of all ganglia events.
 */
export type GangliaEvent = StatusEvent | ArtifactEvent | ContentEvent;

/**
 * Type guard for status events.
 */
export function isStatusEvent(event: GangliaEvent): event is StatusEvent {
  return event.type === 'status';
}

/**
 * Type guard for artifact events.
 */
export function isArtifactEvent(event: GangliaEvent): event is ArtifactEvent {
  return event.type === 'artifact';
}

/**
 * Type guard for content events.
 */
export function isContentEvent(event: GangliaEvent): event is ContentEvent {
  return event.type === 'content';
}

/**
 * Maps tool names to status actions.
 */
export const toolToStatusAction: Record<string, StatusAction> = {
  read_file: 'reading_file',
  Read: 'reading_file',
  write_file: 'writing_file',
  Write: 'writing_file',
  edit_file: 'editing_file',
  Edit: 'editing_file',
  search: 'searching_files',
  grep: 'searching_files',
  Grep: 'searching_files',
  glob: 'searching_files',
  Glob: 'searching_files',
  web_search: 'web_search',
  WebSearch: 'web_search',
  bash: 'executing_command',
  Bash: 'executing_command',
};

/**
 * Creates a status event from a tool call.
 */
export function statusFromToolCall(
  toolName: string,
  args?: Record<string, unknown>,
): StatusEvent {
  const action = toolToStatusAction[toolName] || 'thinking';
  let detail: string | undefined;

  // Extract relevant detail based on tool type
  if (args) {
    if ('path' in args) detail = args.path as string;
    else if ('file_path' in args) detail = args.file_path as string;
    else if ('pattern' in args) detail = args.pattern as string;
    else if ('query' in args) detail = args.query as string;
    else if ('command' in args) detail = args.command as string;
  }

  return {
    type: 'status',
    action,
    detail,
    startedAt: Date.now(),
  };
}
