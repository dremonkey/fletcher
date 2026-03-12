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

// Start idle room cleanup timer
bridgeManager.startIdleTimer(
  Number(process.env.RELAY_IDLE_TIMEOUT_MS ?? 300000), // 5 minutes
);

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.RELAY_HTTP_PORT ?? process.env.PORT ?? 7890),
  fetch: (req) => handleHttpRequest(req, { bridgeManager, roomManager }),
});

console.log(`Fletcher Relay listening on ${server.hostname}:${server.port}`);

// Graceful shutdown
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    console.log("\nShutting down...");
    bridgeManager.stopIdleTimer();
    await bridgeManager.shutdownAll();
    server.stop();
    process.exit(0);
  });
}

export { server, roomManager, bridgeManager };
