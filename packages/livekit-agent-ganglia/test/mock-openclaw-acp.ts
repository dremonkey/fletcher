/**
 * mock-openclaw-acp.ts — Minimal ACP agent for testing AcpLLM.
 *
 * Sends session/update notifications in the OpenClaw wire format:
 * singular `update` object (not `updates[]`).
 */
const decoder = new TextDecoder();
for await (const chunk of Bun.stdin.stream()) {
  for (const line of decoder.decode(chunk).split("\n").filter(Boolean)) {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }

    if (msg.method === "initialize") {
      process.stdout.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          result: { capabilities: {} },
        }) + "\n",
      );
    } else if (msg.method === "session/new") {
      process.stdout.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          result: { sessionId: "mock-acp-sess-001" },
        }) + "\n",
      );
    } else if (msg.method === "session/prompt") {
      const text = msg.params?.prompt?.[0]?.text ?? "";

      // Emit an agent_message_chunk notification (OpenClaw wire format — singular `update`)
      process.stdout.write(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: msg.params?.sessionId ?? "mock-acp-sess-001",
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "Echo: " + text },
            },
          },
        }) + "\n",
      );

      // Resolve the prompt
      process.stdout.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          result: { stopReason: "completed" },
        }) + "\n",
      );
    }
    // Notifications: initialized, exit, session/cancel — no response needed
  }
}
