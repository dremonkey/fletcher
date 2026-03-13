/**
 * @fletcher/acp-client — shared ACP client package
 *
 * Provides the AcpClient class for communicating with an ACP agent subprocess
 * via JSON-RPC 2.0 over newline-delimited stdio.
 */

export { AcpClient } from "./client.js";
export type {
  AcpClientOptions,
  Logger,
  InitializeParams,
  InitializeResult,
  ClientInfo,
  SessionMeta,
  SessionNewParams,
  SessionNewResult,
  ContentPart,
  SessionPromptParams,
  SessionPromptResult,
  SessionCancelParams,
  SessionUpdateKind,
  AgentMessageChunk,
  AvailableCommandsUpdate,
  OpenClawUpdate,
  SessionUpdateParams,
  JsonRpcRequest,
  JsonRpcNotification,
  JsonRpcResponse,
} from "./types.js";
export {
  isRequest,
  makeResponse,
  makeErrorResponse,
  makeNotification,
} from "./rpc.js";
export type { JsonRpcError } from "./rpc.js";
