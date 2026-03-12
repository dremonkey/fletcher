// test/mock-acpx.ts — minimal ACP agent for testing
const decoder = new TextDecoder();
for await (const chunk of Bun.stdin.stream()) {
  for (const line of decoder.decode(chunk).split("\n").filter(Boolean)) {
    const msg = JSON.parse(line);
    if (msg.method === "initialize") {
      console.log(
        JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          result: { capabilities: {} },
        }),
      );
    } else if (msg.method === "session/new") {
      console.log(
        JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          result: { sessionId: "mock-sess-001" },
        }),
      );
    } else if (msg.method === "session/prompt") {
      const text = msg.params.prompt?.[0]?.text ?? "";
      // Stream an update notification, then resolve
      console.log(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            updates: [
              {
                kind: "content_chunk",
                content: { type: "text", text: "Echo: " + text },
              },
            ],
          },
        }),
      );
      console.log(
        JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          result: { stopReason: "completed" },
        }),
      );
    }
    // Notifications like "initialized", "exit", "session/cancel" — no response needed
  }
}
