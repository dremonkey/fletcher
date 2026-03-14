import { WebhookReceiver, RoomServiceClient } from "livekit-server-sdk";
import { handleHttpRequest } from "./http/routes";
import { RoomManager } from "./livekit/room-manager";
import { BridgeManager } from "./bridge/bridge-manager";
import { discoverAndRejoinRooms } from "./livekit/room-discovery";
import { wsUrlToHttp } from "./utils/url";
import { createLogger } from "./utils/logger";

const log = createLogger("relay");

const apiKey = process.env.LIVEKIT_API_KEY ?? "devkey";
const apiSecret = process.env.LIVEKIT_API_SECRET ?? "secret";
const livekitUrl = process.env.LIVEKIT_URL ?? "ws://localhost:7880";

const roomManager = new RoomManager({
  livekitUrl,
  apiKey,
  apiSecret,
});

const webhookReceiver = new WebhookReceiver(apiKey, apiSecret);

const acpCommand = process.env.ACP_COMMAND ?? "openclaw";
const acpArgs = (process.env.ACP_ARGS ?? "acp").split(" ").filter(Boolean);
const departureGraceMs = Number(process.env.RELAY_DEPARTURE_GRACE_MS ?? 120_000);

const bridgeManager = new BridgeManager(
  roomManager,
  acpCommand,
  acpArgs,
  undefined,
  { departureGraceMs },
);

// Start idle room cleanup timer
bridgeManager.startIdleTimer(
  Number(process.env.RELAY_IDLE_TIMEOUT_MS ?? 1_800_000), // 30 minutes
);

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.RELAY_HTTP_PORT ?? process.env.PORT ?? 7890),
  fetch: (req) => handleHttpRequest(req, { bridgeManager, roomManager, acpCommand, acpArgs, webhookReceiver }),
});

log.info(
  { hostname: server.hostname, port: server.port, livekitUrl, acpCommand, acpArgs, pid: process.pid, logLevel: log.level },
  "Fletcher Relay listening",
);

// Fire-and-forget: discover rooms with orphaned human participants and rejoin
const roomService = new RoomServiceClient(wsUrlToHttp(livekitUrl), apiKey, apiSecret);
discoverAndRejoinRooms({ roomService, bridgeManager, logger: log });

// Periodic room discovery: catch rooms missed by disconnect-recovery backoff
bridgeManager.startDiscoveryTimer(
  () => discoverAndRejoinRooms({ roomService, bridgeManager, logger: log }).then(() => {}),
  Number(process.env.RELAY_DISCOVERY_INTERVAL_MS ?? 30_000),
);

// Crash protection: log and exit on unhandled errors (BUG-025)
process.on("uncaughtException", (err) => {
  log.fatal({ err }, "Uncaught exception — exiting");
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  log.fatal({ err: reason }, "Unhandled rejection — exiting");
  process.exit(1);
});

// Graceful shutdown
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    log.info("Shutting down...");
    bridgeManager.stopIdleTimer();
    bridgeManager.stopDiscoveryTimer();
    await bridgeManager.shutdownAll();
    server.stop();
    process.exit(0);
  });
}

export { server, roomManager, bridgeManager };
