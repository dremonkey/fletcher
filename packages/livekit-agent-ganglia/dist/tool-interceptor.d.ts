/**
 * Tool interception for visual feedback.
 *
 * This module provides utilities to intercept tool calls from LLM streams
 * and create status/artifact events for visual feedback in the Flutter app.
 *
 * The interceptor wraps tool execution and emits:
 * - StatusEvent when a tool starts executing
 * - ArtifactEvent with the tool result (files, diffs, search results)
 * - ErrorArtifact when tool execution fails
 *
 * @example
 * ```typescript
 * import { ToolInterceptor } from '@knittt/livekit-agent-ganglia';
 *
 * const interceptor = new ToolInterceptor((event) => {
 *   room.localParticipant.publishData(JSON.stringify(event), { reliable: true });
 * });
 *
 * // Wrap your tool executor
 * const result = await interceptor.execute(toolCall, myToolExecutor);
 * ```
 */
import { type StatusEvent, type ArtifactEvent, type CodeArtifact, type FileArtifact, type MarkdownArtifact, type DiffArtifact, type SearchResultsArtifact, type ErrorArtifact } from './events.js';
/**
 * Represents a tool call from the LLM.
 */
export interface ToolCall {
    /** Tool name (e.g., 'read_file', 'Edit', 'Grep') */
    name: string;
    /** Tool arguments */
    args: Record<string, unknown>;
    /** Optional tool call ID for tracking */
    id?: string;
}
/**
 * Result from a tool execution.
 */
export interface ToolResult {
    /** The result content (string or structured data) */
    content: unknown;
    /** Whether the tool execution was successful */
    success: boolean;
    /** Error message if the tool failed */
    error?: string;
}
/**
 * Function type for executing a tool.
 */
export type ToolExecutor = (toolCall: ToolCall) => Promise<ToolResult>;
/**
 * Callback for emitting ganglia events.
 */
export type EventEmitter = (event: StatusEvent | ArtifactEvent) => void;
/**
 * Configuration for the ToolInterceptor.
 */
export interface ToolInterceptorConfig {
    /** Callback to emit events */
    onEvent: EventEmitter;
    /**
     * Whether to emit status events before tool execution.
     * Default: true
     */
    emitStatus?: boolean;
    /**
     * Whether to emit artifact events after tool execution.
     * Default: true
     */
    emitArtifacts?: boolean;
}
/**
 * Create an artifact event from a read file tool result.
 */
export declare function createReadFileArtifact(toolCall: ToolCall, result: ToolResult): CodeArtifact | MarkdownArtifact | FileArtifact | undefined;
/**
 * Create a diff artifact from an edit tool result.
 */
export declare function createEditArtifact(toolCall: ToolCall, _result: ToolResult): DiffArtifact | undefined;
/**
 * Create a search results artifact from a grep/glob tool result.
 */
export declare function createSearchArtifact(toolCall: ToolCall, result: ToolResult): SearchResultsArtifact | undefined;
/**
 * Create an error artifact from a failed tool execution.
 */
export declare function createErrorArtifact(toolCall: ToolCall, error: string, stack?: string): ErrorArtifact;
/**
 * Create an artifact from a tool call and its result.
 * Returns undefined if no artifact should be created for this tool.
 */
export declare function createArtifactFromToolResult(toolCall: ToolCall, result: ToolResult): ArtifactEvent | undefined;
/**
 * Tool interceptor that wraps tool execution and emits events.
 */
export declare class ToolInterceptor {
    private onEvent;
    private emitStatus;
    private emitArtifacts;
    constructor(config: ToolInterceptorConfig | EventEmitter);
    /**
     * Execute a tool with interception, emitting status and artifact events.
     *
     * @param toolCall - The tool call to execute
     * @param executor - The function that actually executes the tool
     * @returns The tool result
     */
    execute(toolCall: ToolCall, executor: ToolExecutor): Promise<ToolResult>;
    /**
     * Create a wrapped executor function that includes interception.
     *
     * @param executor - The original tool executor
     * @returns A wrapped executor that emits events
     */
    wrap(executor: ToolExecutor): ToolExecutor;
}
/**
 * Create a tool interceptor with the given event emitter.
 */
export declare function createToolInterceptor(config: ToolInterceptorConfig | EventEmitter): ToolInterceptor;
