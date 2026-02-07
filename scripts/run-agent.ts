#!/usr/bin/env bun
/**
 * Run the LiveKit voice agent for development testing.
 *
 * Usage:
 *   bun run agent:dev
 *   bun run agent:dev --room "my-room"
 */

import { AccessToken } from "livekit-server-sdk";
import { Room, RoomEvent } from "@livekit/rtc-node";

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
let roomName = "fletcher-dev";

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--room" && args[i + 1]) {
    roomName = args[i + 1];
    i++;
  }
}

// Generate agent token
async function generateAgentToken(): Promise<string> {
  const token = new AccessToken(LIVEKIT_API_KEY!, LIVEKIT_API_SECRET!, {
    identity: "openclaw-agent",
    name: "OpenClaw Agent",
    ttl: "24h",
  });

  token.addGrant({
    room: roomName,
    roomJoin: true,
    roomCreate: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  return await token.toJwt();
}

// Main agent loop
async function main() {
  console.log("\n--- LiveKit Voice Agent ---\n");
  console.log(`URL:  ${LIVEKIT_URL}`);
  console.log(`Room: ${roomName}`);
  console.log("\nConnecting...\n");

  const token = await generateAgentToken();
  const room = new Room();

  // Set up event handlers
  room.on(RoomEvent.Connected, () => {
    console.log(`Connected to room: ${room.name}`);
    console.log(`Local participant: ${room.localParticipant?.identity}`);
    console.log("\nWaiting for participants...\n");
  });

  room.on(RoomEvent.Disconnected, (reason) => {
    console.log(`Disconnected: ${reason}`);
  });

  room.on(RoomEvent.ParticipantConnected, (participant) => {
    console.log(`Participant joined: ${participant.identity} (${participant.name})`);
  });

  room.on(RoomEvent.ParticipantDisconnected, (participant) => {
    console.log(`Participant left: ${participant.identity}`);
  });

  room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
    console.log(`Subscribed to ${track.kind} track from ${participant.identity}`);
  });

  room.on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
    console.log(`Unsubscribed from ${track.kind} track from ${participant.identity}`);
  });

  // Connect to room
  await room.connect(LIVEKIT_URL!, token);

  // Keep the process running
  console.log("Agent is running. Press Ctrl+C to stop.\n");

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\nShutting down...");
    await room.disconnect();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.log("\nShutting down...");
    await room.disconnect();
    process.exit(0);
  });

  // Keep alive
  await new Promise(() => {});
}

main().catch((error) => {
  console.error("Agent error:", error);
  process.exit(1);
});
