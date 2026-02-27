import * as p from "@clack/prompts";
import { spawn, type Subprocess } from "bun";
import { ROOT, env } from "./env";
import { DEFAULT_ROOM } from "./audit";

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

function isLocalLiveKit(): boolean {
  const url = env("LIVEKIT_URL") || "";
  return url.includes("localhost") || url.includes("127.0.0.1");
}

export async function startServices(): Promise<Subprocess> {
  // 1. LiveKit infrastructure (only for local server)
  if (isLocalLiveKit()) {
    await runStep("Starting LiveKit server", ["bash", "./scripts/setup.sh"]);
  }

  // 2. Token generation
  const room = env("LIVEKIT_ROOM") || DEFAULT_ROOM;
  await runStep("Generating LiveKit token", [
    "bun", "run", "scripts/generate-token.ts", "--room", room,
  ]);

  // 3. Voice agent — start with piped output to check for early crash
  const s = p.spinner();
  s.start("Starting voice agent");

  const agentMode = isLocalLiveKit() ? "dev" : "connect";
  const agentArgs = ["bun", "run", "scripts/voice-agent.ts", agentMode];
  if (agentMode === "connect") {
    agentArgs.push("--room", room);
  }
  const agent = spawn(agentArgs, {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  children.push(agent);

  // Give the agent a couple seconds to crash or stabilize
  const earlyCrash = await Promise.race([
    agent.exited.then((code) => code),
    new Promise<null>((r) => setTimeout(() => r(null), 2000)),
  ]);

  if (earlyCrash !== null) {
    const stderr = await new Response(agent.stderr).text();
    children.splice(children.indexOf(agent), 1);
    s.stop("Starting voice agent — failed");
    if (stderr.trim()) p.log.error(stderr.trim());
    p.cancel("Voice agent failed to start.");
    process.exit(1);
  }

  s.stop("Starting voice agent — running");
  return agent;
}

export function installShutdownHandler(agent: Subprocess): void {
  let shuttingDown = false;

  const cleanup = async () => {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(); // newline after ^C
    p.outro("Shutting down Fletcher...");

    // SIGTERM all children
    for (const child of children) {
      try {
        child.kill("SIGTERM");
      } catch {}
    }

    // Give processes 1s to exit gracefully, then SIGKILL
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
