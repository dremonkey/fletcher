import { handleHttpRequest } from "./http/routes";
import { RoomManager } from "./livekit/room-manager";

const roomManager = new RoomManager({
  livekitUrl: process.env.LIVEKIT_URL ?? "ws://localhost:7880",
  apiKey: process.env.LIVEKIT_API_KEY ?? "devkey",
  apiSecret: process.env.LIVEKIT_API_SECRET ?? "secret",
});

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  fetch: handleHttpRequest,
});

console.log(`Fletcher Relay listening on port ${server.port}`);

// Graceful shutdown
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    console.log("\nShutting down...");
    await roomManager.disconnectAll();
    server.stop();
    process.exit(0);
  });
}

export { server, roomManager };
