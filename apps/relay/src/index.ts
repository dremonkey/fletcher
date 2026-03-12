import { handleHttpRequest } from "./http/routes";
import { RoomManager } from "./livekit/room-manager";
import { BridgeManager } from "./bridge/bridge-manager";

const roomManager = new RoomManager({
  livekitUrl: process.env.LIVEKIT_URL ?? "ws://localhost:7880",
  apiKey: process.env.LIVEKIT_API_KEY ?? "devkey",
  apiSecret: process.env.LIVEKIT_API_SECRET ?? "secret",
});

const bridgeManager = new BridgeManager(
  roomManager,
  process.env.ACP_COMMAND ?? "acpx",
  (process.env.ACP_ARGS ?? "").split(" ").filter(Boolean),
);

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  fetch: handleHttpRequest,
});

console.log(`Fletcher Relay listening on port ${server.port}`);

// Graceful shutdown
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    console.log("\nShutting down...");
    await bridgeManager.shutdownAll();
    server.stop();
    process.exit(0);
  });
}

export { server, roomManager, bridgeManager };
