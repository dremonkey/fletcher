import * as p from "@clack/prompts";
import { spawn, type Subprocess } from "bun";
import { createHash } from "crypto";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { connect, type Socket } from "net";
import { ROOT, env } from "./env";
import { DEFAULT_ROOM } from "./audit";

/** Marker file storing the SHA-256 hash of voice-agent build inputs. */
const BUILD_HASH_FILE = join(ROOT, ".docker-build-hash");
/** Marker file storing the epoch-ms timestamp of the last `docker compose pull livekit`. */
const PULL_MARKER_FILE = join(ROOT, ".docker-pull-timestamp");
/** Minimum interval between upstream LiveKit image pulls (24 hours). */
const PULL_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Glob patterns for every file that feeds into the voice-agent Docker image.
 * Derived from the COPY directives in `apps/voice-agent/Dockerfile`.
 * When any of these change, the image is considered stale and will be rebuilt.
 */
const VOICE_AGENT_SOURCES = [
  "apps/voice-agent/src/**/*.ts",
  "apps/voice-agent/package.json",
  "apps/voice-agent/tsconfig.json",
  "apps/voice-agent/Dockerfile",
  "packages/livekit-agent-ganglia/src/**/*.ts",
  "packages/livekit-agent-ganglia/package.json",
  "packages/livekit-agent-ganglia/tsconfig.json",
  "packages/livekit-agent-ganglia/bunfig.toml",
  "bun.lock",
  "tsconfig.base.json",
];

export const children: Subprocess[] = [];

export async function runStep(
  label: string,
  cmd: string[],
  opts?: { cwd?: string; fatal?: boolean },
): Promise<boolean> {
  const s = p.spinner();
  s.start(label);

  const proc = spawn(cmd, { cwd: opts?.cwd ?? ROOT, stdout: "pipe", stderr: "pipe" });
  children.push(proc);

  const exitCode = await proc.exited;
  children.splice(children.indexOf(proc), 1);

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    s.stop(`${label} — failed (exit ${exitCode})`);
    if (stderr.trim()) p.log.error(stderr.trim());
    if (opts?.fatal === false) return false;
    p.cancel("Service startup failed.");
    process.exit(1);
  }

  s.stop(`${label} — done`);
  return true;
}

/**
 * Poll a TCP port until it accepts connections or the timeout expires.
 * Returns true if the port became reachable, false on timeout.
 */
async function waitForPort(host: string, port: number, timeoutMs: number = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const reachable = await new Promise<boolean>((resolve) => {
      const sock: Socket = connect({ host, port }, () => {
        sock.destroy();
        resolve(true);
      });
      sock.on("error", () => {
        sock.destroy();
        resolve(false);
      });
    });
    if (reachable) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/**
 * Wait for the voice-agent container to log "worker registered", indicating
 * it has successfully connected to the LiveKit server and is ready to receive jobs.
 */
async function waitForAgentRegistration(timeoutMs: number = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const proc = spawn(
      ["docker", "compose", "logs", "--tail", "50", "voice-agent"],
      { cwd: ROOT, stdout: "pipe", stderr: "pipe" },
    );
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    if (output.includes("worker registered")) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

/**
 * Compute a truncated SHA-256 over all files matching {@link VOICE_AGENT_SOURCES}.
 * Both relative path and file contents are fed into the hash so that renames
 * and content changes are both detected.
 */
function computeSourceHash(): string {
  const hash = createHash("sha256");
  for (const pattern of VOICE_AGENT_SOURCES) {
    const glob = new Bun.Glob(pattern);
    const files = [...glob.scanSync({ cwd: ROOT, absolute: true })].sort();
    for (const file of files) {
      hash.update(file.slice(ROOT.length));
      hash.update(readFileSync(file));
    }
  }
  return hash.digest("hex").slice(0, 16);
}

/** Returns `true` when the voice-agent Docker image is stale (hash mismatch or missing marker). */
function voiceAgentNeedsRebuild(): boolean {
  const current = computeSourceHash();
  if (existsSync(BUILD_HASH_FILE)) {
    const stored = readFileSync(BUILD_HASH_FILE, "utf-8").trim();
    if (stored === current) return false;
  }
  return true;
}

/** Returns `true` when we haven't pulled the upstream LiveKit image in the last 24 hours. */
function shouldPullLivekit(): boolean {
  if (!existsSync(PULL_MARKER_FILE)) return true;
  const ts = parseInt(readFileSync(PULL_MARKER_FILE, "utf-8").trim(), 10);
  return Date.now() - ts > PULL_INTERVAL_MS;
}

function isLocalLiveKit(): boolean {
  const url = env("LIVEKIT_URL") || "";
  return url.includes("localhost") || url.includes("127.0.0.1");
}

export async function startServices(): Promise<void> {
  if (isLocalLiveKit()) {
    // Pull latest livekit image (at most once per 24h)
    if (shouldPullLivekit()) {
      await runStep("Pulling latest LiveKit server image", [
        "docker", "compose", "pull", "livekit",
      ]);
      writeFileSync(PULL_MARKER_FILE, String(Date.now()));
    }

    // Rebuild voice-agent image if source files changed (build only, don't start yet)
    const rebuild = voiceAgentNeedsRebuild();
    if (rebuild) {
      await runStep("Building voice-agent image", [
        "docker", "compose", "build", "voice-agent",
      ]);
      writeFileSync(BUILD_HASH_FILE, computeSourceHash());
    }

    // Step 1: Start LiveKit server
    await runStep("Starting LiveKit server", [
      "docker", "compose", "up", "-d", "livekit",
    ]);

    // Step 2: Wait for LiveKit to accept connections on port 7880
    const s1 = p.spinner();
    s1.start("Waiting for LiveKit to be ready (port 7880)");
    const livekitReady = await waitForPort("127.0.0.1", 7880);
    if (!livekitReady) {
      s1.stop("LiveKit failed to become ready within 30s");
      p.cancel("Service startup failed.");
      process.exit(1);
    }
    s1.stop("LiveKit is ready");

    // Step 3: Start voice agent (LiveKit is confirmed ready)
    await runStep("Starting voice agent", [
      "docker", "compose", "up", "-d", "voice-agent",
    ]);

    // Step 4: Wait for agent to register with LiveKit
    const s2 = p.spinner();
    s2.start("Waiting for voice agent to register");
    const agentReady = await waitForAgentRegistration();
    if (!agentReady) {
      s2.stop("Voice agent failed to register within 30s");
      p.log.warn("Agent may not have connected — check `docker compose logs voice-agent`");
    } else {
      s2.stop("Voice agent registered");
    }
  }

  // Step 5: Generate token (only after services are confirmed ready)
  const room = env("LIVEKIT_ROOM") || DEFAULT_ROOM;
  await runStep("Generating LiveKit token", [
    "bun", "run", "scripts/generate-token.ts", "--room", room,
  ]);
}

let shutdownInstalled = false;

export function installShutdownHandler(): void {
  if (shutdownInstalled) return;
  shutdownInstalled = true;

  let shuttingDown = false;

  const cleanup = async () => {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(); // newline after ^C
    p.outro("Shutting down Fletcher...");

    // Stop docker-compose services
    const proc = spawn(["docker", "compose", "down"], {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;

    // SIGTERM any remaining children
    for (const child of children) {
      try {
        child.kill("SIGTERM");
      } catch {}
    }

    await new Promise((r) => setTimeout(r, 1000));
    for (const child of children) {
      try {
        child.kill("SIGKILL");
      } catch {}
    }

    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

export async function pipeStream(stream: ReadableStream<Uint8Array> | null, dest: NodeJS.WriteStream) {
  if (!stream) return;
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      dest.write(value);
    }
  } catch {}
}
