/**
 * Extended event types for voice UX.
 *
 * These events provide feedback during long-running operations
 * and visual artifacts for coding sessions.
 */
/**
 * Type guard for status events.
 */
export function isStatusEvent(event) {
    return event.type === 'status';
}
/**
 * Type guard for artifact events.
 */
export function isArtifactEvent(event) {
    return event.type === 'artifact';
}
/**
 * Type guard for content events.
 */
export function isContentEvent(event) {
    return event.type === 'content';
}
/**
 * Maps tool names to status actions.
 */
export const toolToStatusAction = {
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
export function statusFromToolCall(toolName, args) {
    const action = toolToStatusAction[toolName] || 'thinking';
    let detail;
    // Extract relevant detail based on tool type
    if (args) {
        if ('path' in args)
            detail = args.path;
        else if ('file_path' in args)
            detail = args.file_path;
        else if ('pattern' in args)
            detail = args.pattern;
        else if ('query' in args)
            detail = args.query;
        else if ('command' in args)
            detail = args.command;
    }
    return {
        type: 'status',
        action,
        detail,
        startedAt: Date.now(),
    };
}
