#!/usr/bin/env bun
/**
 * Generate a LiveKit access token for development testing.
 *
 * Usage:
 *   bun run token:generate
 *   bun run token:generate --identity "user123"
 *   bun run token:generate --room "my-room"
 */

import { AccessToken } from "livekit-server-sdk";

const LIVEKIT_URL = process.env.LIVEKIT_URL;
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;

if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
  console.error("Missing required environment variables.");
  console.error("Ensure .env contains:");
  console.error("  LIVEKIT_URL=wss://your-project.livekit.cloud");
  console.error("  LIVEKIT_API_KEY=your-api-key");
  console.error("  LIVEKIT_API_SECRET=your-api-secret");
  process.exit(1);
}

// Parse command line arguments
const args = process.argv.slice(2);
let identity = `user-${Date.now()}`;
let roomName = "fletcher-dev";

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--identity" && args[i + 1]) {
    identity = args[i + 1];
    i++;
  } else if (args[i] === "--room" && args[i + 1]) {
    roomName = args[i + 1];
    i++;
  }
}

// Create access token
const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
  identity,
  ttl: "24h",
});

// Grant permissions for the room
token.addGrant({
  room: roomName,
  roomJoin: true,
  canPublish: true,
  canSubscribe: true,
  canPublishData: true,
});

const jwt = await token.toJwt();

console.log("\n--- LiveKit Token Generated ---\n");
console.log(`URL:      ${LIVEKIT_URL}`);
console.log(`Room:     ${roomName}`);
console.log(`Identity: ${identity}`);
console.log(`Expires:  24 hours\n`);
console.log(`Token:\n${jwt}\n`);
