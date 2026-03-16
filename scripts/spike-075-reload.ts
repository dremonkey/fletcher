#!/usr/bin/env bun
/**
 * TASK-075 Spike Part 2: Cross-process session/load
 *
 * Spawns a FRESH ACP subprocess and loads the session created by
 * spike-075-session.ts to test persistence across process restarts.
 * This is the core session resumption scenario.
 */

import { AcpClient, type SessionUpdateParams } from "../packages/acp-client/src/index";

const sessionKey = "agent:main:spike:session-075";

async function main() {
  console.log("=".repeat(72));
  console.log("TASK-075 SPIKE PART 2: Cross-process session/load");
  console.log("=".repeat(72));
  console.log(`Session key: ${sessionKey}`);
  console.log("(This loads the session built by spike-075-session.ts)\n");

  const log = {
    info(obj: object, msg?: string) { if (msg) console.log(`[INFO] ${msg}`); },
    warn(obj: object, msg?: string) { if (msg) console.warn(`[WARN] ${msg}`); },
    error(obj: object, msg?: string) { if (msg) console.error(`[ERROR] ${msg}`); },
    debug(_obj: object, _msg?: string) {},
  };

  // --- Fresh ACP subprocess with same session key ---
  const client = new AcpClient({
    command: "openclaw",
    args: ["acp", "--session", sessionKey],
    logger: log,
  });

  const updates: SessionUpdateParams[] = [];
  client.onUpdate((params) => {
    updates.push(params);
  });

  await client.initialize();
  console.log("ACP initialized (fresh subprocess)");

  // Create a new session — this should reconnect to the same conversation
  const session = await client.sessionNew({
    cwd: process.cwd(),
    mcpServers: [],
    _meta: { room_name: "spike-075-reload", verbose: true },
  });
  console.log(`Session created: ${session.sessionId}`);
  const initUpdates = [...updates];
  console.log(`Init updates: ${initUpdates.length}`);

  // --- Load the session history ---
  console.log("\n--- session/load on fresh subprocess ---");
  updates.length = 0;
  const loadStart = performance.now();
  await client.sessionLoad({
    sessionId: session.sessionId,
    cwd: process.cwd(),
    mcpServers: [],
  });
  const loadElapsed = (performance.now() - loadStart).toFixed(0);
  console.log(`Loaded in ${loadElapsed}ms, ${updates.length} updates`);

  // Analyze
  const kindCounts: Record<string, number> = {};
  for (const u of updates) {
    const kind = u.update?.sessionUpdate ?? "unknown";
    kindCounts[kind] = (kindCounts[kind] ?? 0) + 1;
  }
  console.log("\nUpdate kinds:", JSON.stringify(kindCounts, null, 2));

  // Extract conversation turns
  const userTurns = updates.filter(u => u.update?.sessionUpdate === "user_message_chunk");
  const agentTurns = updates.filter(u => u.update?.sessionUpdate === "agent_message_chunk");
  console.log(`\nUser turns: ${userTurns.length}`);
  console.log(`Agent turns: ${agentTurns.length}`);

  // Show the reconstructed conversation
  console.log("\n=== RECONSTRUCTED CONVERSATION ===");
  const conversationUpdates = updates.filter(u =>
    u.update?.sessionUpdate === "user_message_chunk" ||
    u.update?.sessionUpdate === "agent_message_chunk"
  );
  for (const u of conversationUpdates) {
    const kind = u.update.sessionUpdate;
    const content = (u.update as Record<string, unknown>).content as { text: string };
    const role = kind === "user_message_chunk" ? "USER" : "AGENT";
    // For user messages, extract just the user text (after the metadata prefix)
    let text = content.text;
    if (role === "USER") {
      // OpenClaw wraps user text in metadata — extract the last line
      const lines = text.split("\n");
      text = lines[lines.length - 1] || text;
    }
    if (role === "AGENT") {
      // Strip <final> tags
      text = text.replace(/<\/?final>/g, "").replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();
    }
    console.log(`\n  [${role}] ${text.slice(0, 200)}`);
  }

  // --- Test: send a follow-up prompt referencing prior context ---
  console.log("\n\n--- Follow-up prompt (tests context continuity) ---");
  updates.length = 0;
  const result = await client.sessionPrompt({
    sessionId: session.sessionId,
    prompt: [{ type: "text", text: "What was the first thing I said to you? And what was my name?" }],
  });
  const agentResponse = updates
    .filter(u => u.update?.sessionUpdate === "agent_message_chunk")
    .map(u => {
      const content = (u.update as Record<string, unknown>).content as { text: string };
      return content.text;
    })
    .join("");
  console.log(`Stop reason: ${result.stopReason}`);
  console.log(`Agent: ${agentResponse.replace(/<\/?final>/g, "").replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim()}`);

  // --- Cleanup ---
  await client.shutdown();
  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
