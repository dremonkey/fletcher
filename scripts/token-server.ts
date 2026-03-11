#!/usr/bin/env bun
/**
 * Lightweight token endpoint for Fletcher mobile clients.
 *
 * Generates LiveKit access tokens on demand so the client can create
 * dynamic room names without bundling API secrets on-device.
 *
 * Usage:
 *   bun run scripts/token-server.ts
 *   TOKEN_SERVER_PORT=7882 bun run scripts/token-server.ts
 *
 * Endpoints:
 *   GET  /token?room=<name>&identity=<id>  → { "token": "<jwt>", "url": "ws://..." }
 *   GET  /health                           → { "ok": true }
 *   POST /dispatch-agent                   → { "status": "dispatched", ... }
 */

import { AccessToken, RoomConfiguration, RoomAgentDispatch, AgentDispatchClient, RoomServiceClient } from "livekit-server-sdk";

/**
 * Convert a WebSocket URL to its HTTP equivalent.
 * LiveKit's LIVEKIT_URL env var is typically ws:// or wss://,
 * but AgentDispatchClient expects http:// or https://.
 */
export function wsUrlToHttp(wsUrl: string): string {
  if (wsUrl.startsWith("wss://")) {
    return "https://" + wsUrl.slice("wss://".length);
  }
  if (wsUrl.startsWith("ws://")) {
    return "http://" + wsUrl.slice("ws://".length);
  }
  return wsUrl;
}

export interface TokenServerConfig {
  livekitUrl: string;
  apiKey: string;
  apiSecret: string;
  agentName: string;
}

/**
 * Create the fetch handler for the token server.
 * Exported for testing — the handler is a pure function of its config.
 */
export function createFetchHandler(config: TokenServerConfig) {
  const httpUrl = wsUrlToHttp(config.livekitUrl);
  const dispatchClient = new AgentDispatchClient(httpUrl, config.apiKey, config.apiSecret);
  const roomService = new RoomServiceClient(httpUrl, config.apiKey, config.apiSecret);

  return async function fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return Response.json({ ok: true });
    }

    if (url.pathname === "/token") {
      const room = url.searchParams.get("room");
      const identity = url.searchParams.get("identity");

      if (!room || !identity) {
        return Response.json(
          { error: "Missing required query params: room, identity" },
          { status: 400 }
        );
      }

      const token = new AccessToken(config.apiKey, config.apiSecret, {
        identity,
        ttl: "24h",
      });

      token.addGrant({
        room,
        roomJoin: true,
        roomCreate: true,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
      });

      token.roomConfig = new RoomConfiguration({
        agents: [new RoomAgentDispatch({
          agentName: config.agentName,
          metadata: JSON.stringify({ user_id: identity }),
        })],
      });

      const jwt = await token.toJwt();
      return Response.json({ token: jwt, url: config.livekitUrl });
    }

    if (req.method === "POST" && url.pathname === "/dispatch-agent") {
      const body = await req.json();
      const roomName = body.room_name;

      if (!roomName || typeof roomName !== "string") {
        return Response.json(
          { status: "error", message: "Missing required field: room_name" },
          { status: 400 },
        );
      }

      try {
        // Guard: check if an agent is already in the room (BUG-013).
        // Prevents duplicate agents when the user force-quits and reconnects
        // before the old agent's departure_timeout expires.
        const PARTICIPANT_KIND_AGENT = 4;
        try {
          const participants = await roomService.listParticipants(roomName);
          const existingAgents = participants.filter(p => p.kind === PARTICIPANT_KIND_AGENT);
          if (existingAgents.length > 0) {
            return Response.json({
              status: "already_present",
              agent_name: existingAgents[0].name || existingAgents[0].identity,
            });
          }
        } catch {
          // Room doesn't exist yet — proceed with dispatch
        }

        const dispatch = await dispatchClient.createDispatch(roomName, config.agentName, {
          metadata: body.metadata ? JSON.stringify(body.metadata) : undefined,
        });

        return Response.json({
          status: "dispatched",
          agent_name: config.agentName,
          dispatch_id: dispatch.id,
        });
      } catch (err: any) {
        return Response.json(
          { status: "error", message: err.message || "Dispatch failed" },
          { status: 500 },
        );
      }
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  };
}

// ---------------------------------------------------------------------------
// Start server when run directly (not imported as a module by tests)
// ---------------------------------------------------------------------------
const isMainModule = import.meta.main;

if (isMainModule) {
  const PORT = parseInt(process.env.TOKEN_SERVER_PORT || "7882", 10);
  const LIVEKIT_URL = process.env.LIVEKIT_URL;
  const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
  const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;
  const AGENT_NAME = process.env.FLETCHER_AGENT_NAME || "fletcher-voice";

  if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    console.error(
      "Missing LIVEKIT_URL, LIVEKIT_API_KEY, or LIVEKIT_API_SECRET in environment"
    );
    process.exit(1);
  }

  const handler = createFetchHandler({
    livekitUrl: LIVEKIT_URL,
    apiKey: LIVEKIT_API_KEY,
    apiSecret: LIVEKIT_API_SECRET,
    agentName: AGENT_NAME,
  });

  const server = Bun.serve({
    port: PORT,
    fetch: handler,
  });

  console.log(`Token server listening on http://localhost:${server.port}`);
}
