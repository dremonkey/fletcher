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
 *   GET /token?room=<name>&identity=<id>  → { "token": "<jwt>", "url": "ws://..." }
 *   GET /health                           → { "ok": true }
 */

import { AccessToken, RoomConfiguration, RoomAgentDispatch } from "livekit-server-sdk";

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
