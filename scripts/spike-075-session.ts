#!/usr/bin/env bun
/**
 * TASK-075 Spike: session/load + session/list fidelity
 *
 * Exercises the ACP client directly:
 * 1. Initialize ACP → log capabilities
 * 2. Create session → send 3 prompts to build history
 * 3. Test session/list → log raw response
 * 4. Test session/load → log all replayed session/update notifications
 * 5. Analyze: what's included (user turns, agent turns, tool calls, artifacts)?
 */

import { AcpClient, type SessionUpdateParams } from "../packages/acp-client/src/index";

// ---------------------------------------------------------------------------
// Logger — dumps everything to stdout
// ---------------------------------------------------------------------------

const log = {
  info(obj: object, msg?: string) {
    if (msg) console.log(`[INFO] ${msg}`, JSON.stringify(obj));
  },
  warn(obj: object, msg?: string) {
    if (msg) console.warn(`[WARN] ${msg}`, JSON.stringify(obj));
  },
  error(obj: object, msg?: string) {
    if (msg) console.error(`[ERROR] ${msg}`, JSON.stringify(obj));
  },
  debug(obj: object, msg?: string) {
    // Verbose — enable for raw wire debugging
    // if (msg) console.log(`[DEBUG] ${msg}`, JSON.stringify(obj));
  },
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=".repeat(72));
  console.log("TASK-075 SPIKE: session/load + session/list fidelity");
  console.log("=".repeat(72));

  // --- Step 1: Initialize ---
  // OpenClaw requires --session <key> to bind the ACP subprocess to a
  // thread. Without it, prompts fail with ACP_SESSION_INIT_FAILED.
  // Format: agent:main:<channel>:<identifier>
  const sessionKey = "agent:main:spike:session-075";

  console.log("\n--- Step 1: Initialize ACP ---");
  console.log(`Session key: ${sessionKey}`);
  const client = new AcpClient({
    command: "openclaw",
    args: ["acp", "--session", sessionKey],
    logger: log,
  });

  const initResult = await client.initialize();
  console.log("\nInitialize result:");
  console.log(JSON.stringify(initResult, null, 2));
  // OpenClaw uses `agentCapabilities` (not `capabilities`)
  const agentCaps = (initResult as Record<string, unknown>).agentCapabilities as Record<string, unknown> | undefined;
  const caps = initResult.capabilities as Record<string, unknown> | undefined;
  console.log("\nagentCapabilities:", JSON.stringify(agentCaps, null, 2));
  console.log("capabilities:", JSON.stringify(caps, null, 2));

  const sessionCaps = (agentCaps?.sessionCapabilities ?? caps?.sessionCapabilities) as Record<string, unknown> | undefined;
  console.log("\n  loadSession:", agentCaps?.loadSession ?? "(not found)");
  console.log("  sessionCapabilities.list:", sessionCaps?.list ?? "(not found)");

  // Collect ALL session/update notifications
  const allUpdates: { phase: string; update: SessionUpdateParams; timestamp: number }[] = [];
  client.onUpdate((params) => {
    allUpdates.push({
      phase: currentPhase,
      update: params,
      timestamp: performance.now(),
    });
  });
  let currentPhase = "init";

  // --- Step 2: Create session + send prompts ---
  console.log("\n--- Step 2: Create session + build conversation history ---");
  // _meta is required by OpenClaw — without it, prompts fail with
  // ACP_SESSION_INIT_FAILED. The relay passes room_name + verbose.
  const session = await client.sessionNew({
    cwd: process.cwd(),
    mcpServers: [],
    _meta: {
      room_name: "spike-075-test",
      verbose: true,
    },
  });
  const sessionId = session.sessionId;
  console.log(`Session created: ${sessionId}`);

  const prompts = [
    "Hello, my name is Fletcher. What is 2 + 2?",
    "What was my name again?",
    "Summarize our conversation so far in one sentence.",
  ];

  for (let i = 0; i < prompts.length; i++) {
    currentPhase = `prompt-${i + 1}`;
    console.log(`\n  Sending prompt ${i + 1}: "${prompts[i]}"`);
    const startTime = performance.now();
    const result = await client.sessionPrompt({
      sessionId,
      prompt: [{ type: "text", text: prompts[i] }],
    });
    const elapsed = (performance.now() - startTime).toFixed(0);
    console.log(`  Result (${elapsed}ms): stopReason=${result.stopReason}`);

    // Show agent response text from updates collected during this prompt
    const promptUpdates = allUpdates.filter((u) => u.phase === `prompt-${i + 1}`);
    const agentText = promptUpdates
      .filter((u) => u.update.update?.sessionUpdate === "agent_message_chunk")
      .map((u) => {
        const content = (u.update.update as { content?: { text?: string } })?.content;
        return content?.text ?? "";
      })
      .join("");
    console.log(`  Agent response (${agentText.length} chars): ${agentText.slice(0, 200)}${agentText.length > 200 ? "..." : ""}`);
  }

  console.log(`\nTotal updates during prompts: ${allUpdates.length}`);

  // --- Step 3: Test session/list ---
  console.log("\n" + "=".repeat(72));
  console.log("--- Step 3: Test session/list ---");
  currentPhase = "list";
  try {
    const listStart = performance.now();
    const listResult = await client.sessionList();
    const listElapsed = (performance.now() - listStart).toFixed(0);
    console.log(`\nsession/list completed in ${listElapsed}ms`);
    console.log("\nRaw response:");
    console.log(JSON.stringify(listResult, null, 2));

    if (listResult.sessions?.length) {
      console.log(`\nFound ${listResult.sessions.length} session(s):`);
      for (const s of listResult.sessions) {
        console.log(`  • ${JSON.stringify(s)}`);
      }
    } else {
      console.log("\nNo sessions returned. Full result keys:", Object.keys(listResult));
    }
  } catch (err) {
    console.error("\nsession/list FAILED:");
    console.error(err);
    if (err && typeof err === "object" && "code" in err) {
      console.error(`ACP error code: ${(err as { code: number }).code}`);
      console.error(`ACP error data: ${JSON.stringify((err as { data?: unknown }).data)}`);
    }
  }

  // --- Step 4: Test session/load ---
  console.log("\n" + "=".repeat(72));
  console.log("--- Step 4: Test session/load (replay history) ---");
  currentPhase = "load";
  const preLoadCount = allUpdates.length;
  try {
    const loadStart = performance.now();
    await client.sessionLoad({
      sessionId,
      cwd: process.cwd(),
      mcpServers: [],
    });
    const loadElapsed = (performance.now() - loadStart).toFixed(0);

    const loadUpdates = allUpdates.filter((u) => u.phase === "load");
    console.log(`\nsession/load completed in ${loadElapsed}ms`);
    console.log(`Replayed ${loadUpdates.length} session/update notifications`);

    // Categorize what was replayed
    const kindCounts: Record<string, number> = {};
    let totalTextLength = 0;
    const contentTypes = new Set<string>();

    for (const u of loadUpdates) {
      const kind = u.update.update?.sessionUpdate ?? "unknown";
      kindCounts[kind] = (kindCounts[kind] ?? 0) + 1;

      const update = u.update.update as Record<string, unknown>;

      // Analyze content structure
      if (update?.content) {
        const content = update.content as Record<string, unknown>;
        contentTypes.add(content.type as string ?? "unknown");
        if (typeof content.text === "string") {
          totalTextLength += content.text.length;
        }
      }
    }

    console.log("\n=== REPLAY ANALYSIS ===");
    console.log("Update kinds:", JSON.stringify(kindCounts, null, 2));
    console.log("Content types:", [...contentTypes]);
    console.log("Total text length:", totalTextLength);

    // Key question: are user turns included?
    console.log("\n=== KEY QUESTIONS ===");
    const hasUserTurns = loadUpdates.some((u) => {
      const update = u.update.update as Record<string, unknown>;
      return update?.sessionUpdate === "user_message" || update?.role === "user";
    });
    console.log("User turns included?", hasUserTurns);

    const hasAgentTurns = loadUpdates.some((u) => {
      return u.update.update?.sessionUpdate === "agent_message_chunk";
    });
    console.log("Agent turns included?", hasAgentTurns);

    const hasToolCalls = loadUpdates.some((u) => {
      const update = u.update.update as Record<string, unknown>;
      return update?.sessionUpdate === "tool_call" || update?.sessionUpdate?.includes?.("tool");
    });
    console.log("Tool calls included?", hasToolCalls);

    const hasArtifacts = loadUpdates.some((u) => {
      const update = u.update.update as Record<string, unknown>;
      return update?.sessionUpdate === "artifact" || update?.sessionUpdate?.includes?.("artifact");
    });
    console.log("Artifacts included?", hasArtifacts);

    // Dump every update for full analysis
    console.log("\n=== FULL REPLAY DUMP ===");
    for (let i = 0; i < loadUpdates.length; i++) {
      const u = loadUpdates[i];
      console.log(`\n--- Update ${i} ---`);
      console.log(JSON.stringify(u.update, null, 2));
    }

  } catch (err) {
    console.error("\nsession/load FAILED:");
    console.error(err);
    if (err && typeof err === "object" && "code" in err) {
      console.error(`ACP error code: ${(err as { code: number }).code}`);
      console.error(`ACP error data: ${JSON.stringify((err as { data?: unknown }).data)}`);
    }
  }

  // --- Step 5: Summary ---
  console.log("\n" + "=".repeat(72));
  console.log("--- Step 5: Summary ---");
  console.log(`Session ID: ${sessionId}`);
  console.log(`Prompts sent: ${prompts.length}`);
  console.log(`Total updates collected: ${allUpdates.length}`);

  const phaseBreakdown: Record<string, number> = {};
  for (const u of allUpdates) {
    phaseBreakdown[u.phase] = (phaseBreakdown[u.phase] ?? 0) + 1;
  }
  console.log("Updates by phase:", JSON.stringify(phaseBreakdown, null, 2));

  // --- Cleanup ---
  console.log("\n--- Shutting down ---");
  await client.shutdown();
  console.log("Done.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
