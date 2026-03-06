import { type ToolCall, type ToolResult, type ToolExecutor, type ToolInterceptorConfig } from './tool-interceptor.js';
export interface EventInterceptorConfig extends ToolInterceptorConfig {
    /**
     * Callback to publish raw data to the data channel.
     * This is where the chunking happens.
     */
    publishData: (data: string) => void;
}
/**
 * Enhanced interceptor that handles protocol-specific logic:
 * - Status filtering/debouncing
 * - Artifact generation
 * - Message chunking
 */
export declare class EventInterceptor {
    private toolInterceptor;
    private publishData;
    private lastStatus?;
    private statusDebounceMs;
    constructor(config: EventInterceptorConfig);
    /**
     * Main entry point for tool execution.
     */
    execute(toolCall: ToolCall, executor: ToolExecutor): Promise<ToolResult>;
    /**
     * Wraps an executor function.
     */
    wrap(executor: ToolExecutor): ToolExecutor;
    /**
     * Handles internal events from ToolInterceptor, applies protocol logic,
     * and publishes to the data channel.
     */
    private handleEvent;
    /**
     * Determines if a status event should be emitted based on debouncing/filtering rules.
     */
    private shouldEmitStatus;
    /**
     * Publishes an event to the data channel, handling chunking if necessary.
     */
    private publish;
    /**
     * Splits a large message into chunks and sends them.
     */
    private sendChunks;
    private uint8ArrayToBase64;
}
