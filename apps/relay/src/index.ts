import { SessionManager } from "./session/manager";
import { createRpcHandler } from "./rpc/handler";
import { runAgent } from "./session/agent-bridge";
import { handleHttpRequest } from "./http/routes";
import type { WebSocketData } from "./session/types";

const manager = new SessionManager();
const handleMessage = createRpcHandler(manager, runAgent);

const server = Bun.serve<WebSocketData>({
  port: parseInt(process.env.PORT || "3000"),

  fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket upgrade on /ws
    if (url.pathname === "/ws") {
      const upgraded = server.upgrade(req, {
        data: {
          connId: crypto.randomUUID().slice(0, 8),
        } satisfies WebSocketData,
      });
      if (!upgraded) {
        return new Response("WebSocket upgrade failed", { status: 400 });
      }
      return undefined;
    }

    // HTTP routes
    return handleHttpRequest(req, manager);
  },

  websocket: {
    open(ws) {
      console.log(`[ws] connected: ${ws.data.connId}`);
    },

    message(ws, raw) {
      const msg = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
      handleMessage(msg, ws);
    },

    close(ws, code, reason) {
      console.log(`[ws] disconnected: ${ws.data.connId} (${code})`);
      // TODO: optionally cancel sessions owned by this connection
    },
  },
});

console.log(`Claude Relay listening on port ${server.port}`);

// Graceful shutdown
function shutdown() {
  console.log("\nShutting down...");
  server.stop();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Export for testing
export { server, manager };
