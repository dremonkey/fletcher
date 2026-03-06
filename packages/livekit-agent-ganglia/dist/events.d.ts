/**
 * Extended event types for voice UX.
 *
 * These events provide feedback during long-running operations
 * and visual artifacts for coding sessions.
 */
/**
 * Status event actions - what the agent is currently doing.
 */
export type StatusAction = 'thinking' | 'searching_files' | 'reading_file' | 'writing_file' | 'editing_file' | 'web_search' | 'executing_command' | 'analyzing';
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
export type ArtifactType = 'diff' | 'code' | 'markdown' | 'file' | 'search_results' | 'error';
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
export type ArtifactEvent = DiffArtifact | CodeArtifact | MarkdownArtifact | FileArtifact | SearchResultsArtifact | ErrorArtifact;
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
export declare function isStatusEvent(event: GangliaEvent): event is StatusEvent;
/**
 * Type guard for artifact events.
 */
export declare function isArtifactEvent(event: GangliaEvent): event is ArtifactEvent;
/**
 * Type guard for content events.
 */
export declare function isContentEvent(event: GangliaEvent): event is ContentEvent;
/**
 * Maps tool names to status actions.
 */
export declare const toolToStatusAction: Record<string, StatusAction>;
/**
 * Creates a status event from a tool call.
 */
export declare function statusFromToolCall(toolName: string, args?: Record<string, unknown>): StatusEvent;
