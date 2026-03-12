import type { BridgeManager } from "../bridge/bridge-manager";
import type { RoomManager } from "../livekit/room-manager";
import { AcpClient } from "../acp/client";
import type { SessionUpdateParams } from "../acp/types";

const startTime = Date.now();

/**
 * Context needed by HTTP route handlers.
 */
export interface RouteContext {
  bridgeManager: BridgeManager;
  roomManager: RoomManager;
  acpCommand: string;
  acpArgs: string[];
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

  // POST /relay/prompt — CLI test endpoint (bypasses LiveKit)
  if (url.pathname === "/relay/prompt" && req.method === "POST") {
    return handleRelayPrompt(req, ctx);
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

// ---------------------------------------------------------------------------
// POST /relay/prompt — CLI test endpoint (no LiveKit needed)
// ---------------------------------------------------------------------------

async function handleRelayPrompt(
  req: Request,
  ctx: RouteContext,
): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { text } = (body as { text?: string }) ?? {};
  if (!text || typeof text !== "string") {
    return Response.json(
      { error: 'Missing required field: text (e.g. {"text":"hello"})' },
      { status: 400 },
    );
  }

  const client = new AcpClient({
    command: ctx.acpCommand,
    args: ctx.acpArgs,
  });

  const updates: SessionUpdateParams[] = [];

  try {
    // 1. Initialize ACP
    await client.initialize();

    // 2. Create session
    const session = await client.sessionNew({
      _meta: { room_name: "cli-test" },
    });

    // 3. Collect streaming updates
    client.onUpdate((params) => {
      updates.push(params);
    });

    // 4. Send prompt
    const result = await client.sessionPrompt({
      sessionId: session.sessionId,
      prompt: [{ type: "text", text }],
    });

    // 5. Shutdown
    await client.shutdown();

    return Response.json({
      sessionId: session.sessionId,
      stopReason: result.stopReason,
      updates,
    });
  } catch (err) {
    try { await client.shutdown(); } catch { /* already dead */ }
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json(
      { error: `ACP error: ${message}` },
      { status: 500 },
    );
  }
}
