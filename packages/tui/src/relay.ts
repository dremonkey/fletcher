import * as p from "@clack/prompts";
import { spawn, which } from "bun";
import { join } from "path";
import { mkdirSync, openSync, closeSync } from "fs";
import { ROOT, env, cancelled } from "./env";

const RELAY_DIR = join(ROOT, "apps", "relay");
const MOCK_ACPX = join(RELAY_DIR, "test", "mock-acpx.ts");
const LOGS_DIR = join(ROOT, "logs");

function resolveAcpBackend(): { command: string; args: string; label: string } {
  const explicit = env("ACP_COMMAND");
  if (explicit) {
    return { command: explicit, args: env("ACP_ARGS") ?? "", label: explicit };
  }
  if (which("openclaw")) {
    return { command: "openclaw", args: "acp", label: "openclaw acp" };
  }
  return { command: "bun", args: MOCK_ACPX, label: "mock-acpx" };
}

export async function testRelay(): Promise<void> {
  const backend = resolveAcpBackend();

  p.log.info(`ACP backend: ${backend.label}`);

  const message = await p.text({
    message: "Message to send:",
    placeholder: "hello",
    defaultValue: "hello",
  });
  if (p.isCancel(message)) cancelled();

  const port = env("RELAY_HTTP_PORT") ?? "7891";
  const url = `http://127.0.0.1:${port}`;

  // Check if relay is already running
  const alreadyRunning = await fetch(`${url}/health`)
    .then(() => true)
    .catch(() => false);

  let relayProc: ReturnType<typeof spawn> | null = null;
  let logFd: number | null = null;

  if (!alreadyRunning) {
    const s = p.spinner();
    s.start("Starting relay");

    mkdirSync(LOGS_DIR, { recursive: true });
    const logFile = join(LOGS_DIR, `relay-test-${new Date().toISOString().slice(0, 10)}.log`);
    logFd = openSync(logFile, "a");

    relayProc = spawn(["bun", "run", join(RELAY_DIR, "src/index.ts")], {
      env: {
        ...process.env,
        ACP_COMMAND: backend.command,
        ACP_ARGS: backend.args,
        RELAY_HTTP_PORT: port,
        LOG_LEVEL: "debug",
      },
      stdout: logFd,
      stderr: logFd,
    });

    p.log.info(`Relay logs → ${logFile}`);

    // Wait for ready
    let ready = false;
    for (let i = 0; i < 30; i++) {
      await Bun.sleep(200);
      ready = await fetch(`${url}/health`)
        .then(() => true)
        .catch(() => false);
      if (ready) break;
    }

    if (!ready) {
      s.stop("Relay failed to start");
      relayProc.kill();
      return;
    }
    s.stop("Relay started");
  } else {
    p.log.info("Relay already running");
  }

  // Send prompt
  const s2 = p.spinner();
  s2.start(`Sending: "${message}"`);

  try {
    const res = await fetch(`${url}/relay/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message }),
    });

    const body = (await res.json()) as {
      error?: string;
      sessionId?: string;
      result?: { stopReason?: string };
      updates?: unknown[];
    };

    if (body.error) {
      s2.stop("Error");
      p.log.error(body.error);
      return;
    }

    // Extract text from updates (ACP format: session/update notifications)
    const chunks: string[] = [];
    for (const raw of body.updates ?? []) {
      const u = raw as Record<string, unknown>;
      // ACP: { update: { content: { type: "text", text } } }
      const update = u.update as Record<string, unknown> | undefined;
      if (update?.content) {
        const c = update.content as { type?: string; text?: string };
        if (c?.type === "text" && c?.text) chunks.push(c.text);
      }
      // Mock format: { updates: [{ content: { text } }] }
      const updates = u.updates as Array<Record<string, unknown>> | undefined;
      for (const item of updates ?? []) {
        const c = item.content as { text?: string } | undefined;
        if (c?.text) chunks.push(c.text);
      }
    }

    s2.stop("Response received");
    p.log.success(chunks.join("") || "(empty response)");
    p.log.info(`Session: ${body.sessionId}  Stop: ${body.result?.stopReason ?? "unknown"}`);
  } catch (err) {
    s2.stop("Request failed");
    p.log.error(err instanceof Error ? err.message : String(err));
  } finally {
    if (relayProc) {
      relayProc.kill();
    }
    if (logFd !== null) {
      closeSync(logFd);
    }
  }
}
