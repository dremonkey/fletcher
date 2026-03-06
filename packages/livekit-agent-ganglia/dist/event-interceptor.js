import { ToolInterceptor, } from './tool-interceptor.js';
// Maximum payload size for LiveKit data channel messages (bytes)
// Leaving some headroom for headers/envelope overhead
const MAX_CHUNK_SIZE = 14 * 1024; // 14KB
/**
 * Enhanced interceptor that handles protocol-specific logic:
 * - Status filtering/debouncing
 * - Artifact generation
 * - Message chunking
 */
export class EventInterceptor {
    toolInterceptor;
    publishData;
    lastStatus;
    statusDebounceMs = 500; // Minimum time between status updates of the same type
    constructor(config) {
        this.publishData = config.publishData;
        // Initialize the base ToolInterceptor with our internal handler
        this.toolInterceptor = new ToolInterceptor({
            onEvent: (event) => this.handleEvent(event),
            emitStatus: config.emitStatus,
            emitArtifacts: config.emitArtifacts,
        });
    }
    /**
     * Main entry point for tool execution.
     */
    async execute(toolCall, executor) {
        return this.toolInterceptor.execute(toolCall, executor);
    }
    /**
     * Wraps an executor function.
     */
    wrap(executor) {
        return (toolCall) => this.execute(toolCall, executor);
    }
    /**
     * Handles internal events from ToolInterceptor, applies protocol logic,
     * and publishes to the data channel.
     */
    handleEvent(event) {
        if (event.type === 'status') {
            if (this.shouldEmitStatus(event)) {
                this.publish(event);
            }
        }
        else if (event.type === 'artifact') {
            // Artifacts are always important
            this.publish(event);
        }
        else {
            // Content/other events pass through
            this.publish(event);
        }
    }
    /**
     * Determines if a status event should be emitted based on debouncing/filtering rules.
     */
    shouldEmitStatus(event) {
        const now = Date.now();
        // Always emit if it's a different action type
        if (!this.lastStatus || this.lastStatus.action !== event.action) {
            this.lastStatus = { action: event.action, timestamp: now };
            return true;
        }
        // If same action, check debounce timer
        if (now - this.lastStatus.timestamp > this.statusDebounceMs) {
            this.lastStatus = { action: event.action, timestamp: now };
            return true;
        }
        return false;
    }
    /**
     * Publishes an event to the data channel, handling chunking if necessary.
     */
    publish(event) {
        const json = JSON.stringify(event);
        const bytes = new TextEncoder().encode(json);
        if (bytes.length <= MAX_CHUNK_SIZE) {
            // Send directly if small enough
            this.publishData(json);
        }
        else {
            // Chunking required
            this.sendChunks(json, bytes);
        }
    }
    /**
     * Splits a large message into chunks and sends them.
     */
    sendChunks(originalJson, bytes) {
        // Generate a simple transfer ID
        const transferId = Math.random().toString(36).substring(2, 15);
        const totalChunks = Math.ceil(bytes.length / MAX_CHUNK_SIZE);
        for (let i = 0; i < totalChunks; i++) {
            const start = i * MAX_CHUNK_SIZE;
            const end = Math.min(start + MAX_CHUNK_SIZE, bytes.length);
            const chunkBytes = bytes.slice(start, end);
            // Convert chunk to base64 string for safe JSON transport
            // Note: This adds ~33% overhead, but keeps the transport text-based (JSON)
            // which is safer for the flexible `payload` structure we defined.
            const chunkData = this.uint8ArrayToBase64(chunkBytes);
            const chunkMessage = {
                type: 'chunk',
                transfer_id: transferId,
                chunk_index: i,
                total_chunks: totalChunks,
                data: chunkData,
            };
            this.publishData(JSON.stringify(chunkMessage));
        }
    }
    // Helper to convert Uint8Array to Base64 in browser/node environments
    uint8ArrayToBase64(bytes) {
        let binary = '';
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }
}
