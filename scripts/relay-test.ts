#!/usr/bin/env bun
/**
 * Test the relay's ACP bridge from the command line.
 *
 * Usage:
 *   bun run relay:test "hello"
 *   bun run relay:test                    # defaults to "hello"
 *
 * Auto-detects backend: uses acpx if installed, otherwise mock-acpx.
 * Override with ACP_COMMAND env var if needed.
 */

import path from "path";
import { which } from "bun";

const text = process.argv[2] ?? "hello";
const port = process.env.RELAY_HTTP_PORT ?? "7891";
const url = `http://127.0.0.1:${port}`;
const relayDir = path.resolve(import.meta.dir, "../apps/relay");

/** Resolve ACP command: explicit env > acpx on PATH > mock */
function resolveAcpBackend(): { command: string; args: string; label: string } {
  if (process.env.ACP_COMMAND) {
    return {
      command: process.env.ACP_COMMAND,
      args: process.env.ACP_ARGS ?? "",
      label: process.env.ACP_COMMAND,
    };
  }

  if (which("acpx")) {
    return { command: "acpx", args: "", label: "acpx" };
  }

  return {
    command: "bun",
    args: path.join(relayDir, "test/mock-acpx.ts"),
    label: "mock-acpx (install acpx for real backend)",
  };
}

// Check if relay is already running
const isRunning = await fetch(`${url}/health`)
  .then(() => true)
  .catch(() => false);

let relayProc: ReturnType<typeof Bun.spawn> | null = null;

if (!isRunning) {
  const backend = resolveAcpBackend();

  console.log(`Starting relay (backend: ${backend.label})...`);

  relayProc = Bun.spawn(["bun", "run", path.join(relayDir, "src/index.ts")], {
    env: {
      ...process.env,
      ACP_COMMAND: backend.command,
      ACP_ARGS: backend.args,
      RELAY_HTTP_PORT: port,
    },
    stdout: "inherit",
    stderr: "inherit",
  });

  // Wait for relay to be ready
  for (let i = 0; i < 30; i++) {
    await Bun.sleep(200);
    const ready = await fetch(`${url}/health`)
      .then(() => true)
      .catch(() => false);
    if (ready) break;
  }

  // Verify it started
  const ready = await fetch(`${url}/health`)
    .then(() => true)
    .catch(() => false);
  if (!ready) {
    console.error("Failed to start relay");
    relayProc.kill();
    process.exit(1);
  }
} else {
  console.log(`Relay already running on ${url}`);
}

// Send prompt
console.log(`\n> ${text}\n`);

try {
  const res = await fetch(`${url}/relay/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  const body = (await res.json()) as {
    error?: string;
    sessionId?: string;
    stopReason?: string;
    updates?: Array<{
      updates?: Array<{ kind?: string; content?: { text?: string } }>;
    }>;
  };

  if (body.error) {
    console.error(`Error: ${body.error}`);
    process.exit(1);
  }

  // Extract and display text from updates
  for (const update of body.updates ?? []) {
    for (const u of update.updates ?? []) {
      if (u.content?.text) {
        process.stdout.write(u.content.text);
      }
    }
  }
  console.log();
  console.log(`\nSession: ${body.sessionId}`);
  console.log(`Stop reason: ${body.stopReason}`);
} finally {
  if (relayProc) {
    relayProc.kill();
  }
}
