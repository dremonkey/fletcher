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

const bridgeManager = new BridgeManager(
  roomManager,
  acpCommand,
  acpArgs,
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

// Graceful shutdown
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    log.info("Shutting down...");
    bridgeManager.stopIdleTimer();
    await bridgeManager.shutdownAll();
    server.stop();
    process.exit(0);
  });
}

export { server, roomManager, bridgeManager };
