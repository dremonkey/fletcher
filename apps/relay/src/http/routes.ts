const startTime = Date.now();

export function handleHttpRequest(req: Request): Response {
  const url = new URL(req.url);

  if (url.pathname === "/health") {
    return Response.json({
      status: "ok",
      uptime: Math.floor((Date.now() - startTime) / 1000),
    });
  }

  return Response.json({ error: "Not found" }, { status: 404 });
}
