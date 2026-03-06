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

import { AccessToken } from "livekit-server-sdk";

const PORT = parseInt(process.env.TOKEN_SERVER_PORT || "7882", 10);
const LIVEKIT_URL = process.env.LIVEKIT_URL;
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;

if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
  console.error(
    "Missing LIVEKIT_URL, LIVEKIT_API_KEY, or LIVEKIT_API_SECRET in environment"
  );
  process.exit(1);
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
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

      const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
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

      const jwt = await token.toJwt();
      return Response.json({ token: jwt, url: LIVEKIT_URL });
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },
});

console.log(`Token server listening on http://localhost:${server.port}`);
