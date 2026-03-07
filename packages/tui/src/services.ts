import * as p from "@clack/prompts";
import { spawn, type Subprocess } from "bun";
import { createHash } from "crypto";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { ROOT, env } from "./env";
import { DEFAULT_ROOM } from "./audit";

/** Marker file storing the SHA-256 hash of voice-agent build inputs. */
const BUILD_HASH_FILE = join(ROOT, ".docker-build-hash");
/** Marker file storing the epoch-ms timestamp of the last `docker compose pull`. */
const PULL_MARKER_FILE = join(ROOT, ".docker-pull-timestamp");
/** Minimum interval between upstream image pulls (24 hours). */
const PULL_INTERVAL_MS = 24 * 60 * 60 * 1000;
/**
 * Read upstream (non-build) image names from docker-compose.yml.
 * Filters out locally-built images (those without a '/') like "fletcher-voice-agent".
 */
function getUpstreamImages(): string[] {
  const result = Bun.spawnSync(["docker", "compose", "config", "--images"], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) return [];
  return result.stdout.toString().trim().split("\n").filter((img) => img.includes("/"));
}

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

  const proc = spawn(cmd, { cwd: opts?.cwd ?? ROOT, stdout: "ignore", stderr: "pipe" });
  children.push(proc);

  // Start draining stderr before awaiting exit to prevent pipe-buffer deadlock
  const stderrPromise = new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  children.splice(children.indexOf(proc), 1);

  if (exitCode !== 0) {
    const stderr = await stderrPromise;
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
 * Wait for the voice-agent container to log "registered worker", indicating
 * it has successfully connected to the LiveKit server and is ready to receive jobs.
 */
async function waitForAgentRegistration(timeoutMs: number = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const proc = spawn(
      ["docker", "compose", "logs", "--tail", "50", "voice-agent"],
      { cwd: ROOT, stdout: "pipe", stderr: "ignore" },
    );
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    if (output.includes("registered worker")) return true;
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

/** Returns `true` when we haven't pulled recently or an image is missing locally. */
function shouldPullImages(): boolean {
  if (!existsSync(PULL_MARKER_FILE)) return true;
  const ts = parseInt(readFileSync(PULL_MARKER_FILE, "utf-8").trim(), 10);
  if (Date.now() - ts > PULL_INTERVAL_MS) return true;

  // Even if we pulled recently, check that all images exist locally.
  // Catches the case where a new service was added since the last pull.
  for (const image of getUpstreamImages()) {
    const result = Bun.spawnSync(["docker", "image", "inspect", image], {
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode !== 0) return true;
  }
  return false;
}

function isLocalLiveKit(): boolean {
  const url = env("LIVEKIT_URL") || "";
  return url.includes("localhost") || url.includes("127.0.0.1");
}

export async function startServices(): Promise<void> {
  if (isLocalLiveKit()) {
    // Pull upstream images (at most once per 24h)
    if (shouldPullImages()) {
      await runStep("Pulling upstream images", [
        "docker", "compose", "pull", "--ignore-buildable",
      ]);
      writeFileSync(PULL_MARKER_FILE, String(Date.now()));
    }

    // Rebuild voice-agent image if source files changed (build only, don't start yet)
    const currentHash = computeSourceHash();
    const storedHash = existsSync(BUILD_HASH_FILE)
      ? readFileSync(BUILD_HASH_FILE, "utf-8").trim()
      : null;
    if (storedHash !== currentHash) {
      p.log.info(`Voice-agent source changed (${storedHash?.slice(0, 8) ?? "no prior build"} → ${currentHash.slice(0, 8)})`);
      await runStep("Building voice-agent image", [
        "docker", "compose", "build", "voice-agent",
      ]);
      writeFileSync(BUILD_HASH_FILE, currentHash);
    } else {
      p.log.info(`Voice-agent image up to date (${currentHash.slice(0, 8)})`);
    }

    // Start all services — docker-compose handles dependency ordering:
    //   livekit (healthcheck: port 7880) → voice-agent, token-server
    //   piper (started) → voice-agent
    await runStep("Starting services (LiveKit, Piper, token server, voice agent)", [
      "docker", "compose", "up", "-d", "voice-agent", "token-server",
    ]);

    // Wait for agent to register with LiveKit
    const s1 = p.spinner();
    s1.start("Waiting for voice agent to register");
    const agentReady = await waitForAgentRegistration();
    if (!agentReady) {
      s1.stop("Voice agent failed to register within 30s");
      p.log.warn("Agent may not have connected — check `docker compose logs voice-agent`");
    } else {
      s1.stop("Voice agent registered");
    }
  }

}

/**
 * Generate a LiveKit access token and write it to apps/mobile/.env.
 * Uses LIVEKIT_API_KEY and LIVEKIT_API_SECRET — no running server needed.
 */
export async function generateToken(): Promise<void> {
  const room = env("LIVEKIT_ROOM") || DEFAULT_ROOM;
  await runStep("Generating LiveKit token", [
    "bun", "run", "scripts/generate-token.ts", "--room", room,
  ]);
}

let shuttingDown = false;

/**
 * Synchronous cleanup: SIGTERM children → docker compose down → SIGKILL stragglers.
 *
 * Must be synchronous (uses Bun.spawnSync) so it completes before the process
 * exits — an async handler races with the main flow when child processes die
 * from the same SIGINT.
 */
function cleanup(): void {
  if (shuttingDown) return;
  shuttingDown = true;

  try {
    console.log(); // newline after ^C
    console.log("Shutting down Fletcher...");

    for (const child of children) {
      try {
        child.kill("SIGTERM");
      } catch {}
    }

    Bun.spawnSync(["docker", "compose", "down"], {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });

    for (const child of children) {
      try {
        child.kill("SIGKILL");
      } catch {}
    }
  } catch (err) {
    console.error("Cleanup error:", err);
  }

  process.exit(0);
}

/**
 * (Re-)register SIGINT/SIGTERM handlers for graceful shutdown.
 *
 * Must be called **after** any @clack/prompts spinner or interactive prompt
 * finishes.  Bun has a bug where adding then removing a second signal handler
 * silently disconnects the first handler from native signal dispatch (the JS
 * listener list still looks correct).  Clack spinners do exactly this — they
 * add their own SIGINT handler on start() and remove it on stop().
 *
 * Calling this function re-registers the handler so native dispatch works again.
 */
export function installShutdownHandler(): void {
  process.removeListener("SIGINT", cleanup);
  process.removeListener("SIGTERM", cleanup);
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
