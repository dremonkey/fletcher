import type { BridgeManager } from "../bridge/bridge-manager";
import type { RoomManager } from "../livekit/room-manager";

const startTime = Date.now();

/**
 * Context needed by HTTP route handlers.
 */
export interface RouteContext {
  bridgeManager: BridgeManager;
  roomManager: RoomManager;
}

export async function handleHttpRequest(
  req: Request,
  ctx: RouteContext,
): Promise<Response> {
  const url = new URL(req.url);

  // GET /health — liveness check with room/ACP counts
  if (url.pathname === "/health") {
    const rooms = ctx.roomManager.getActiveRooms();
    const acpRooms = ctx.bridgeManager.getActiveRooms();

    return Response.json({
      status: "ok",
      uptime: Math.floor((Date.now() - startTime) / 1000),
      rooms: rooms.length,
      acpProcesses: acpRooms.length,
    });
  }

  // GET /rooms — active room details
  if (url.pathname === "/rooms" && req.method === "GET") {
    return handleGetRooms(ctx);
  }

  // POST /relay/join — token server signals relay to join a room
  if (url.pathname === "/relay/join" && req.method === "POST") {
    return handleRelayJoin(req, ctx.bridgeManager);
  }

  return Response.json({ error: "Not found" }, { status: 404 });
}

// ---------------------------------------------------------------------------
// GET /rooms
// ---------------------------------------------------------------------------

function handleGetRooms(ctx: RouteContext): Response {
  const roomConnections = ctx.roomManager.getActiveRooms();

  const rooms = roomConnections.map((conn) => {
    const bridge = ctx.bridgeManager.getBridge(conn.roomName);
    return {
      roomName: conn.roomName,
      joinedAt: conn.joinedAt,
      lastActivity: conn.lastActivity,
      acpStatus: bridge?.isStarted ? "connected" : "disconnected",
      sessionId: bridge?.getSessionId() ?? null,
    };
  });

  return Response.json({ rooms });
}

// ---------------------------------------------------------------------------
// POST /relay/join
// ---------------------------------------------------------------------------

async function handleRelayJoin(
  req: Request,
  bridgeManager: BridgeManager,
): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  if (typeof body !== "object" || body === null) {
    return Response.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const { roomName } = body as { roomName?: string };

  if (!roomName || typeof roomName !== "string") {
    return Response.json(
      { error: "Missing required field: roomName" },
      { status: 400 },
    );
  }

  // Check if already joined
  if (bridgeManager.hasRoom(roomName)) {
    return Response.json({
      status: "already_joined",
      roomName,
    });
  }

  try {
    await bridgeManager.addRoom(roomName);
    return Response.json({
      status: "joined",
      roomName,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json(
      { error: `Failed to join room: ${message}` },
      { status: 500 },
    );
  }
}
