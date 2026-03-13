/**
 * ACP (Agent Client Protocol) types for stdio transport.
 *
 * Builds on the JSON-RPC 2.0 types from rpc.ts.
 * ACP uses JSON-RPC 2.0 over newline-delimited stdio.
 */

import type {
  JsonRpcRequest,
  JsonRpcNotification,
  JsonRpcResponse,
} from "./rpc";

// Re-export JSON-RPC types for convenience
export type { JsonRpcRequest, JsonRpcNotification, JsonRpcResponse };

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

/**
 * Generic logger interface accepted by AcpClient.
 * Compatible with pino, winston, console, or any structured logger.
 */
export interface Logger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
  debug(obj: object, msg?: string): void;
}

// ---------------------------------------------------------------------------
// Client options
// ---------------------------------------------------------------------------

/** Configuration for spawning an ACP agent subprocess. */
export interface AcpClientOptions {
  /** Command to spawn (e.g. "acpx", "bun"). */
  command: string;
  /** Arguments to pass to the command. */
  args?: string[];
  /** Additional environment variables for the subprocess. */
  env?: Record<string, string>;
  /** Optional logger for structured logging. Defaults to silent if not provided. */
  logger?: Logger;
}

// ---------------------------------------------------------------------------
// Initialize
// ---------------------------------------------------------------------------

export interface ClientInfo {
  name: string;
  version: string;
}

export interface InitializeParams {
  protocolVersion: number;
  clientInfo: ClientInfo;
  capabilities: Record<string, unknown>;
}

export interface InitializeResult {
  capabilities: Record<string, unknown>;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

/** Routing metadata passed in session/new. */
export interface SessionMeta {
  session_key?: { type: string; key: string };
  room_name?: string;
  participant_identity?: string;
  [key: string]: unknown;
}

export interface SessionNewParams {
  cwd?: string;
  mcpServers?: unknown[];
  _meta?: SessionMeta;
}

export interface SessionNewResult {
  sessionId: string;
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

export interface ContentPart {
  type: string;
  text: string;
}

export interface SessionPromptParams {
  sessionId: string;
  prompt: ContentPart[];
}

export interface SessionPromptResult {
  stopReason: string;
}

// ---------------------------------------------------------------------------
// Cancel (notification — no response expected)
// ---------------------------------------------------------------------------

export interface SessionCancelParams {
  sessionId?: string;
}

// ---------------------------------------------------------------------------
// Update (notification from agent)
//
// OpenClaw ACP sends session/update with a singular `update` field
// (not the `updates` array that the relay protocol exposes to mobile).
// ---------------------------------------------------------------------------

/** Discriminated union tag for OpenClaw session update payloads. */
export type SessionUpdateKind =
  | "agent_message_chunk"
  | "available_commands_update"
  | string; // forward-compatible

export interface AgentMessageChunk {
  sessionUpdate: "agent_message_chunk";
  content: ContentPart;
}

export interface AvailableCommandsUpdate {
  sessionUpdate: "available_commands_update";
  availableCommands: unknown[];
}

export type OpenClawUpdate = AgentMessageChunk | AvailableCommandsUpdate | { sessionUpdate: string; [key: string]: unknown };

/** Raw params from OpenClaw's session/update notification. */
export interface SessionUpdateParams {
  sessionId: string;
  update: OpenClawUpdate;
}
