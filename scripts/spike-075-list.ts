#!/usr/bin/env bun
/**
 * TASK-075 Spike: session/list with cwd parameter
 *
 * The spec (https://agentclientprotocol.com/rfds/session-list) says
 * cwd is an optional filter. Let's try with and without it.
 */

import { AcpClient } from "../packages/acp-client/src/index";

const sessionKey = "agent:main:spike:session-075";

async function main() {
  console.log("=".repeat(72));
  console.log("TASK-075 SPIKE: session/list with cwd");
  console.log("=".repeat(72));

  const log = {
    info(obj: object, msg?: string) { if (msg) console.log(`[INFO] ${msg}`); },
    warn(obj: object, msg?: string) { if (msg) console.warn(`[WARN] ${msg}`); },
    error(obj: object, msg?: string) { if (msg) console.error(`[ERROR] ${msg}`); },
    debug(_obj: object, _msg?: string) {},
  };

  const client = new AcpClient({
    command: "openclaw",
    args: ["acp", "--session", sessionKey],
    logger: log,
  });

  await client.initialize();
  console.log("ACP initialized\n");

  // Test 1: session/list with no params
  console.log("--- Test 1: session/list({}) ---");
  try {
    const result = await client.sessionList();
    console.log("SUCCESS:", JSON.stringify(result, null, 2));
  } catch (err) {
    console.error("FAILED:", err);
  }

  // Test 2: session/list with cwd
  console.log("\n--- Test 2: session/list({ cwd: process.cwd() }) ---");
  try {
    const result = await client.sessionList({ cwd: process.cwd() });
    console.log("SUCCESS:", JSON.stringify(result, null, 2));
  } catch (err) {
    console.error("FAILED:", err);
  }

  // Test 3: session/list with cwd = "~"
  console.log("\n--- Test 3: session/list({ cwd: '~' }) ---");
  try {
    const result = await client.sessionList({ cwd: "~" });
    console.log("SUCCESS:", JSON.stringify(result, null, 2));
  } catch (err) {
    console.error("FAILED:", err);
  }

  await client.shutdown();
  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
