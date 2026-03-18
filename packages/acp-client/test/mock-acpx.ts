// test/mock-acpx.ts — minimal ACP agent for testing
//
// Supports:
// - Normal echo prompts (sends agent_message_chunk, returns "completed")
// - "[no-echo]" prompts (no update, returns "end_turn") — BUG-022 workaround tests
// - "session/load" method (replays history + async chunk) — BUG-022 workaround tests

const SESSION_ID = "mock-sess-001";

/** Track all agent_message_chunk updates sent, for loadSession replay. */
const chunkHistory: Array<{ sessionUpdate: string; content: { type: string; text: string } }> = [];

function emit(obj: object): void {
  console.log(JSON.stringify(obj));
}

function emitSessionUpdate(update: object): void {
  emit({
    jsonrpc: "2.0",
    method: "session/update",
    params: { sessionId: SESSION_ID, update },
  });
}

const decoder = new TextDecoder();
for await (const chunk of Bun.stdin.stream()) {
  for (const line of decoder.decode(chunk).split("\n").filter(Boolean)) {
    const msg = JSON.parse(line);

    if (msg.method === "initialize") {
      emit({ jsonrpc: "2.0", id: msg.id, result: { capabilities: {}, agentInfo: { name: "mock-acpx", version: "0.0.1" } } });

    } else if (msg.method === "session/new") {
      emit({ jsonrpc: "2.0", id: msg.id, result: { sessionId: SESSION_ID } });

    } else if (msg.method === "session/prompt") {
      const text = msg.params.prompt?.[0]?.text ?? "";

      if (text === "[no-echo]") {
        // WORKAROUND test: BUG-022 — simulate a prompt that completes with
        // no agent_message_chunk (as happens when a sub-agent result is lost).
        emit({ jsonrpc: "2.0", id: msg.id, result: { stopReason: "end_turn" } });
      } else {
        // Normal echo: send agent_message_chunk update, then resolve
        const update = {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Echo: " + text },
        };
        chunkHistory.push(update);
        emitSessionUpdate(update);
        emit({ jsonrpc: "2.0", id: msg.id, result: { stopReason: "completed" } });
      }

    } else if (msg.method === "session/load") {
      // WORKAROUND test: BUG-022 — replay all stored chunks + one async result
      // ACP spec: agent MUST replay entire conversation as session/update
      // notifications before returning the result.
      for (const update of chunkHistory) {
        emitSessionUpdate(update);
      }
      // Simulate an async sub-agent result that was never dispatched
      const asyncUpdate = {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Async sub-agent result" },
      };
      emitSessionUpdate(asyncUpdate);
      chunkHistory.push(asyncUpdate);
      emit({ jsonrpc: "2.0", id: msg.id, result: null });
    }
    // Notifications like "initialized", "exit", "session/cancel" — no response needed
  }
}
