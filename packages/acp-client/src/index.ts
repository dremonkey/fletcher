/**
 * @fletcher/acp-client — shared ACP client package
 *
 * Provides the AcpClient class for communicating with an ACP agent subprocess
 * via JSON-RPC 2.0 over newline-delimited stdio.
 */

export { AcpClient } from "./client";
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
} from "./types";
export {
  isRequest,
  makeResponse,
  makeErrorResponse,
  makeNotification,
} from "./rpc";
export type { JsonRpcError } from "./rpc";
