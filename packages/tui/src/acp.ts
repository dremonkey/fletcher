/**
 * "Interact with ACP" submenu — direct ACP client operations for
 * development, debugging, and spike exploration.
 *
 * Spawns an ACP subprocess directly (no relay) and offers:
 *   - New session (session/new)
 *   - Send prompt (session/prompt)
 *   - List sessions (session/list)
 *   - Load session history (session/load — replays as session/update)
 */

import * as p from "@clack/prompts";
import { which } from "bun";
import { join } from "path";
import { AcpClient, type SessionUpdateParams, type InitializeResult } from "@fletcher/acp-client";
import { ROOT, env, cancelled } from "./env";

const RELAY_DIR = join(ROOT, "apps", "relay");
const MOCK_ACPX = join(RELAY_DIR, "test", "mock-acpx.ts");

// ---------------------------------------------------------------------------
// ACP backend resolution (shared with relay.ts)
// ---------------------------------------------------------------------------

function resolveAcpBackend(): { command: string; args: string[]; label: string } {
  const explicit = env("ACP_COMMAND");
  if (explicit) {
    const args = env("ACP_ARGS")?.split(/\s+/).filter(Boolean) ?? [];
    return { command: explicit, args, label: explicit };
  }
  if (which("openclaw")) {
    return { command: "openclaw", args: ["acp"], label: "openclaw acp" };
  }
  return { command: "bun", args: [MOCK_ACPX], label: "mock-acpx" };
}

// ---------------------------------------------------------------------------
// Console logger for ACP client (visible in TUI)
// ---------------------------------------------------------------------------

const acpLogger = {
  info(obj: object, msg?: string) { if (msg) p.log.info(`[acp] ${msg}`); },
  warn(obj: object, msg?: string) { if (msg) p.log.warn(`[acp] ${msg}`); },
  error(obj: object, msg?: string) { if (msg) p.log.error(`[acp] ${msg}`); },
  debug(_obj: object, _msg?: string) { /* silent in TUI */ },
};

// ---------------------------------------------------------------------------
// Submenu
// ---------------------------------------------------------------------------

export async function interactWithAcp(): Promise<void> {
  const backend = resolveAcpBackend();
  p.log.info(`ACP backend: ${backend.label}`);

  // OpenClaw requires --session <key> to bind the subprocess to a thread.
  // Without it, prompts fail with ACP_SESSION_INIT_FAILED.
  const sessionKeyInput = await p.text({
    message: "Session key (OpenClaw thread binding):",
    placeholder: "agent:main:tui:default",
    defaultValue: "agent:main:tui:default",
  });
  if (p.isCancel(sessionKeyInput)) cancelled();
  const sessionKey = (sessionKeyInput as string).trim();

  // --- Initialize ACP client ---
  const s = p.spinner();
  s.start("Initializing ACP subprocess");

  let client: AcpClient;
  let initResult: InitializeResult;
  try {
    client = new AcpClient({
      command: backend.command,
      args: [...backend.args, "--session", sessionKey],
      logger: acpLogger,
    });
    initResult = await client.initialize();
    s.stop("ACP initialized");
  } catch (err) {
    s.stop("ACP initialization failed");
    p.log.error(err instanceof Error ? err.message : String(err));
    return;
  }

  // Show capabilities (OpenClaw uses agentCapabilities, not capabilities)
  const agentCaps = (initResult as Record<string, unknown>).agentCapabilities;
  p.log.info(`Agent capabilities: ${JSON.stringify(agentCaps, null, 2)}`);

  // Collect session/update notifications for display
  let updateLog: SessionUpdateParams[] = [];
  client.onUpdate((params) => {
    updateLog.push(params);
  });

  // Track active session
  let sessionId: string | null = null;

  // --- Submenu loop ---
  try {
    while (true) {
      const action = await p.select({
        message: `ACP session: ${sessionId ?? "(none)"}  —  What next?`,
        options: [
          { value: "new", label: "New session", hint: "session/new" },
          { value: "prompt", label: "Send prompt", hint: "session/prompt (requires active session)" },
          { value: "list", label: "List sessions", hint: "session/list" },
          { value: "load", label: "Load session history", hint: "session/load → replays session/update" },
          { value: "back", label: "Back to main menu" },
        ],
      });
      if (p.isCancel(action)) break;
      if (action === "back") break;

      if (action === "new") {
        await doSessionNew(client, (id) => { sessionId = id; });
      } else if (action === "prompt") {
        if (!sessionId) {
          p.log.warn("No active session. Create one first with 'New session'.");
          continue;
        }
        await doSessionPrompt(client, sessionId, updateLog);
      } else if (action === "list") {
        await doSessionList(client);
      } else if (action === "load") {
        await doSessionLoad(client, sessionId, updateLog);
      }
    }
  } finally {
    // Always clean up
    const s2 = p.spinner();
    s2.start("Shutting down ACP");
    await client.shutdown();
    s2.stop("ACP shut down");
  }
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

async function doSessionNew(
  client: AcpClient,
  onSession: (id: string) => void,
): Promise<void> {
  const s = p.spinner();
  s.start("Creating session");
  try {
    const result = await client.sessionNew({
      cwd: process.cwd(),
      mcpServers: [],
    });
    onSession(result.sessionId);
    s.stop(`Session created: ${result.sessionId}`);
  } catch (err) {
    s.stop("session/new failed");
    p.log.error(err instanceof Error ? err.message : String(err));
  }
}

async function doSessionPrompt(
  client: AcpClient,
  sessionId: string,
  updateLog: SessionUpdateParams[],
): Promise<void> {
  const message = await p.text({
    message: "Message to send:",
    placeholder: "hello",
    defaultValue: "hello",
  });
  if (p.isCancel(message)) return;

  // Clear update log to capture only this prompt's updates
  updateLog.length = 0;

  const s = p.spinner();
  s.start(`Sending: "${message}"`);
  try {
    const result = await client.sessionPrompt({
      sessionId,
      prompt: [{ type: "text", text: message as string }],
    });
    s.stop(`Prompt completed (stop: ${result.stopReason})`);

    // Show collected updates
    if (updateLog.length === 0) {
      p.log.warn("No session/update notifications received during prompt.");
    } else {
      displayUpdates(updateLog, "Prompt updates");
    }
  } catch (err) {
    s.stop("session/prompt failed");
    p.log.error(err instanceof Error ? err.message : String(err));
  }
}

async function doSessionList(client: AcpClient): Promise<void> {
  const s = p.spinner();
  s.start("Listing sessions");
  try {
    const result = await client.sessionList();
    s.stop("Sessions listed");

    // Dump the raw result for spike analysis
    p.log.info("=== session/list raw response ===");
    p.log.info(JSON.stringify(result, null, 2));

    if (result.sessions?.length) {
      p.log.success(`Found ${result.sessions.length} session(s)`);
      for (const session of result.sessions) {
        p.log.info(`  • ${session.sessionId} ${JSON.stringify(session)}`);
      }
    } else {
      p.log.warn("No sessions returned (or unexpected response shape).");
    }
  } catch (err) {
    s.stop("session/list failed");
    p.log.error(err instanceof Error ? err.message : String(err));
    // Log the full error for spike debugging
    if (err && typeof err === "object" && "code" in err) {
      p.log.error(`ACP error code: ${(err as { code: number }).code}`);
    }
  }
}

async function doSessionLoad(
  client: AcpClient,
  activeSessionId: string | null,
  updateLog: SessionUpdateParams[],
): Promise<void> {
  // Ask which session to load — default to active session
  const targetId = await p.text({
    message: "Session ID to load:",
    placeholder: activeSessionId ?? "paste-a-session-id",
    defaultValue: activeSessionId ?? "",
  });
  if (p.isCancel(targetId) || !(targetId as string).trim()) {
    p.log.warn("No session ID provided.");
    return;
  }

  // Clear update log to capture only load replay
  updateLog.length = 0;

  const startTime = performance.now();
  const s = p.spinner();
  s.start(`Loading session history for ${targetId}`);
  try {
    await client.sessionLoad({
      sessionId: targetId as string,
      cwd: process.cwd(),
      mcpServers: [],
    });
    const elapsed = (performance.now() - startTime).toFixed(0);
    s.stop(`Session loaded (${elapsed}ms, ${updateLog.length} updates)`);

    // Dump full replay for spike analysis
    displayUpdates(updateLog, "Session load replay");

    // Summary stats
    const stats = analyzeUpdates(updateLog);
    p.log.info("=== Replay analysis ===");
    p.log.info(JSON.stringify(stats, null, 2));
  } catch (err) {
    s.stop("session/load failed");
    p.log.error(err instanceof Error ? err.message : String(err));
    if (err && typeof err === "object" && "code" in err) {
      p.log.error(`ACP error code: ${(err as { code: number }).code}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

function displayUpdates(updates: SessionUpdateParams[], label: string): void {
  p.log.info(`=== ${label} (${updates.length} updates) ===`);

  for (let i = 0; i < updates.length; i++) {
    const u = updates[i];
    const kind = u.update?.sessionUpdate ?? "unknown";
    const preview = truncate(JSON.stringify(u.update), 200);
    p.log.info(`  [${i}] ${kind}: ${preview}`);
  }

  // Also dump the full raw JSON for the first and last few
  if (updates.length > 0) {
    p.log.info("--- First update (full JSON) ---");
    p.log.info(JSON.stringify(updates[0], null, 2));
  }
  if (updates.length > 1) {
    p.log.info("--- Last update (full JSON) ---");
    p.log.info(JSON.stringify(updates[updates.length - 1], null, 2));
  }
}

function analyzeUpdates(updates: SessionUpdateParams[]): Record<string, unknown> {
  const kindCounts: Record<string, number> = {};
  let totalTextLength = 0;
  const uniqueSessionIds = new Set<string>();

  for (const u of updates) {
    const kind = u.update?.sessionUpdate ?? "unknown";
    kindCounts[kind] = (kindCounts[kind] ?? 0) + 1;
    uniqueSessionIds.add(u.sessionId);

    // Count text content
    const content = (u.update as Record<string, unknown>)?.content;
    if (content && typeof content === "object" && "text" in (content as object)) {
      totalTextLength += ((content as { text: string }).text ?? "").length;
    }
  }

  return {
    totalUpdates: updates.length,
    updateKinds: kindCounts,
    totalTextLength,
    uniqueSessionIds: [...uniqueSessionIds],
  };
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}
