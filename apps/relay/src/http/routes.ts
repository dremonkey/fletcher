import type { SessionManager } from "../session/manager";

const startTime = Date.now();

export function handleHttpRequest(req: Request, manager: SessionManager): Response {
  const url = new URL(req.url);

  if (url.pathname === "/health") {
    return Response.json({
      status: "ok",
      uptime: Math.floor((Date.now() - startTime) / 1000),
    });
  }

  if (url.pathname === "/sessions") {
    return Response.json({
      sessions: manager.listSessions(),
    });
  }

  return Response.json({ error: "Not found" }, { status: 404 });
}
