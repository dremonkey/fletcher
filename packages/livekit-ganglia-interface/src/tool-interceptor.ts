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
 * import { ToolInterceptor } from '@anthropic/livekit-ganglia-interface';
 *
 * const interceptor = new ToolInterceptor((event) => {
 *   room.localParticipant.publishData(JSON.stringify(event), { reliable: true });
 * });
 *
 * // Wrap your tool executor
 * const result = await interceptor.execute(toolCall, myToolExecutor);
 * ```
 */

import {
  statusFromToolCall,
  type StatusEvent,
  type ArtifactEvent,
  type CodeArtifact,
  type FileArtifact,
  type DiffArtifact,
  type SearchResultsArtifact,
  type ErrorArtifact,
} from './events.js';

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
 * Detect language from file extension.
 */
function detectLanguage(filePath: string): string | undefined {
  const ext = filePath.split('.').pop()?.toLowerCase();
  const langMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    py: 'python',
    rb: 'ruby',
    go: 'go',
    rs: 'rust',
    java: 'java',
    kt: 'kotlin',
    swift: 'swift',
    c: 'c',
    cpp: 'cpp',
    h: 'c',
    hpp: 'cpp',
    cs: 'csharp',
    php: 'php',
    sql: 'sql',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    xml: 'xml',
    html: 'html',
    css: 'css',
    scss: 'scss',
    md: 'markdown',
    dart: 'dart',
  };
  return ext ? langMap[ext] : undefined;
}

/**
 * Extract file path from tool arguments.
 */
function extractFilePath(args: Record<string, unknown>): string | undefined {
  // Try common arg names in order of preference
  const pathKeys = ['file_path', 'path', 'file'];
  for (const key of pathKeys) {
    if (typeof args[key] === 'string') {
      return args[key] as string;
    }
  }
  return undefined;
}

/**
 * Check if tool name matches any of the given names (case-insensitive).
 */
function matchesToolName(toolName: string, ...names: string[]): boolean {
  const lower = toolName.toLowerCase();
  return names.some((n) => n.toLowerCase() === lower);
}

/**
 * Create an artifact event from a read file tool result.
 */
export function createReadFileArtifact(
  toolCall: ToolCall,
  result: ToolResult,
): CodeArtifact | FileArtifact | undefined {
  if (!result.success || typeof result.content !== 'string') {
    return undefined;
  }

  const filePath = extractFilePath(toolCall.args);
  if (!filePath) {
    return undefined;
  }

  const language = detectLanguage(filePath);
  const content = result.content;

  // Use CodeArtifact for source code files, FileArtifact for others
  if (language) {
    return {
      type: 'artifact',
      artifact_type: 'code',
      content,
      file: filePath,
      language,
      title: filePath.split('/').pop(),
    };
  }

  return {
    type: 'artifact',
    artifact_type: 'file',
    path: filePath,
    content,
    title: filePath.split('/').pop(),
  };
}

/**
 * Create a diff artifact from an edit tool result.
 */
export function createEditArtifact(
  toolCall: ToolCall,
  _result: ToolResult,
): DiffArtifact | undefined {
  const filePath = extractFilePath(toolCall.args);
  if (!filePath) {
    return undefined;
  }

  // Extract old and new strings for diff context
  const oldString = toolCall.args.old_string as string | undefined;
  const newString = toolCall.args.new_string as string | undefined;

  // Generate a simple unified diff representation
  let diff = '';
  if (oldString !== undefined && newString !== undefined) {
    // Create a minimal unified diff
    const oldLines = oldString.split('\n');
    const newLines = newString.split('\n');

    diff = `--- ${filePath}\n+++ ${filePath}\n`;
    diff += `@@ -1,${oldLines.length} +1,${newLines.length} @@\n`;
    for (const line of oldLines) {
      diff += `-${line}\n`;
    }
    for (const line of newLines) {
      diff += `+${line}\n`;
    }
  } else {
    // Fallback: just indicate a change happened
    diff = `--- ${filePath}\n+++ ${filePath}\n@@ Edit applied @@\n`;
  }

  return {
    type: 'artifact',
    artifact_type: 'diff',
    file: filePath,
    diff,
    title: `Edit: ${filePath.split('/').pop()}`,
  };
}

/**
 * Parse search result content into structured results.
 * Handles ripgrep-style output: "file:line:content"
 */
function parseSearchResults(
  content: unknown,
): Array<{ file: string; line: number; content: string }> {
  const results: Array<{ file: string; line: number; content: string }> = [];

  if (typeof content === 'string') {
    // Parse ripgrep-style output: "file:line:content"
    const lines = content.split('\n').filter((l) => l.trim());
    for (const line of lines) {
      const match = line.match(/^([^:]+):(\d+):(.*)$/);
      if (match) {
        results.push({
          file: match[1],
          line: parseInt(match[2], 10),
          content: match[3],
        });
      }
    }
  } else if (Array.isArray(content)) {
    // Handle pre-structured results
    for (const item of content) {
      if (
        typeof item === 'object' &&
        item !== null &&
        'file' in item &&
        'line' in item
      ) {
        results.push({
          file: String(item.file),
          line: Number(item.line),
          content: String((item as { content?: unknown }).content ?? ''),
        });
      }
    }
  }

  return results;
}

/**
 * Create a search results artifact from a grep/glob tool result.
 */
export function createSearchArtifact(
  toolCall: ToolCall,
  result: ToolResult,
): SearchResultsArtifact | undefined {
  if (!result.success) {
    return undefined;
  }

  const query =
    (toolCall.args.pattern as string) ||
    (toolCall.args.query as string) ||
    (toolCall.args.path as string) ||
    '';

  const results = parseSearchResults(result.content);

  // Don't create artifact if no results
  if (results.length === 0 && typeof result.content !== 'string') {
    return undefined;
  }

  return {
    type: 'artifact',
    artifact_type: 'search_results',
    query,
    results:
      results.length > 0
        ? results
        : [{ file: '', line: 0, content: String(result.content).slice(0, 500) }],
    title: `Search: ${query.slice(0, 30)}${query.length > 30 ? '...' : ''}`,
  };
}

/**
 * Create an error artifact from a failed tool execution.
 */
export function createErrorArtifact(
  toolCall: ToolCall,
  error: string,
  stack?: string,
): ErrorArtifact {
  return {
    type: 'artifact',
    artifact_type: 'error',
    message: error,
    stack,
    title: `Error: ${toolCall.name}`,
  };
}

/**
 * Create an artifact from a tool call and its result.
 * Returns undefined if no artifact should be created for this tool.
 */
export function createArtifactFromToolResult(
  toolCall: ToolCall,
  result: ToolResult,
): ArtifactEvent | undefined {
  // Handle errors
  if (!result.success) {
    return createErrorArtifact(toolCall, result.error || 'Unknown error');
  }

  const toolName = toolCall.name;

  // Read file tools -> CodeArtifact or FileArtifact
  if (matchesToolName(toolName, 'read_file', 'Read')) {
    return createReadFileArtifact(toolCall, result);
  }

  // Edit file tools -> DiffArtifact
  if (matchesToolName(toolName, 'edit_file', 'Edit', 'apply_diff')) {
    return createEditArtifact(toolCall, result);
  }

  // Search tools -> SearchResultsArtifact
  if (matchesToolName(toolName, 'grep', 'Grep', 'glob', 'Glob', 'search')) {
    return createSearchArtifact(toolCall, result);
  }

  // Write file tools don't produce artifacts (the content is already known)
  // Bash/command tools don't produce artifacts by default

  return undefined;
}

/**
 * Tool interceptor that wraps tool execution and emits events.
 */
export class ToolInterceptor {
  private onEvent: EventEmitter;
  private emitStatus: boolean;
  private emitArtifacts: boolean;

  constructor(config: ToolInterceptorConfig | EventEmitter) {
    if (typeof config === 'function') {
      this.onEvent = config;
      this.emitStatus = true;
      this.emitArtifacts = true;
    } else {
      this.onEvent = config.onEvent;
      this.emitStatus = config.emitStatus ?? true;
      this.emitArtifacts = config.emitArtifacts ?? true;
    }
  }

  /**
   * Execute a tool with interception, emitting status and artifact events.
   *
   * @param toolCall - The tool call to execute
   * @param executor - The function that actually executes the tool
   * @returns The tool result
   */
  async execute(toolCall: ToolCall, executor: ToolExecutor): Promise<ToolResult> {
    // Emit status event before execution
    if (this.emitStatus) {
      const statusEvent = statusFromToolCall(toolCall.name, toolCall.args);
      this.onEvent(statusEvent);
    }

    let result: ToolResult;

    try {
      result = await executor(toolCall);
    } catch (error) {
      // Handle execution errors
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      result = {
        content: '',
        success: false,
        error: errorMessage,
      };

      // Emit error artifact
      if (this.emitArtifacts) {
        const errorArtifact = createErrorArtifact(
          toolCall,
          errorMessage,
          errorStack,
        );
        this.onEvent(errorArtifact);
      }

      return result;
    }

    // Emit artifact event after successful execution
    if (this.emitArtifacts) {
      const artifact = createArtifactFromToolResult(toolCall, result);
      if (artifact) {
        this.onEvent(artifact);
      }
    }

    return result;
  }

  /**
   * Create a wrapped executor function that includes interception.
   *
   * @param executor - The original tool executor
   * @returns A wrapped executor that emits events
   */
  wrap(executor: ToolExecutor): ToolExecutor {
    return (toolCall: ToolCall) => this.execute(toolCall, executor);
  }
}

/**
 * Create a tool interceptor with the given event emitter.
 */
export function createToolInterceptor(
  config: ToolInterceptorConfig | EventEmitter,
): ToolInterceptor {
  return new ToolInterceptor(config);
}
