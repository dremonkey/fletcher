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

export async function startServices(): Promise<void> {
  // 1. Start infrastructure + voice agent via docker-compose
  if (isLocalLiveKit()) {
    const services = ["livekit", "voice-agent"];
    await runStep("Starting services (docker compose)", [
      "docker", "compose", "up", "-d", ...services,
    ]);
  }

  // 2. Token generation (needed for mobile client, runs on host)
  const room = env("LIVEKIT_ROOM") || DEFAULT_ROOM;
  await runStep("Generating LiveKit token", [
    "bun", "run", "scripts/generate-token.ts", "--room", room,
  ]);
}

export function installShutdownHandler(): void {
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
