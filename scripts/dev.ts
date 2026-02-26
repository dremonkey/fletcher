#!/usr/bin/env bun
/**
 * TUI dev launcher for Fletcher.
 *
 * Audits the environment, prompts for missing keys, and orchestrates
 * all services (LiveKit, token generation, voice agent) with spinner feedback.
 *
 * Usage:
 *   bun dev
 */

import * as p from "@clack/prompts";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { spawn, type Subprocess } from "bun";

const ROOT = join(import.meta.dirname, "..");
const ENV_PATH = join(ROOT, ".env");

// ── Helpers ──────────────────────────────────────────────────────────

function loadEnv(): Record<string, string> {
  if (!existsSync(ENV_PATH)) return {};
  const content = readFileSync(ENV_PATH, "utf-8");
  const env: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return env;
}

function appendToEnv(key: string, value: string): void {
  let content = "";
  if (existsSync(ENV_PATH)) {
    content = readFileSync(ENV_PATH, "utf-8");
  }

  const lines = content.split("\n");
  let found = false;
  const updated = lines.map((line) => {
    if (line.startsWith(`${key}=`)) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });

  if (!found) {
    updated.push(`${key}=${value}`);
  }

  const result =
    updated.filter((line, i, arr) => line !== "" || i < arr.length - 1).join("\n") + "\n";
  writeFileSync(ENV_PATH, result);
}

function setKey(key: string, value: string): void {
  appendToEnv(key, value);
  process.env[key] = value;
}

function env(key: string): string | undefined {
  return process.env[key] || undefined;
}

function cancelled(): never {
  p.cancel("Cancelled.");
  process.exit(0);
}

// ── Phase 1: Environment Audit ───────────────────────────────────────

async function auditEnv(): Promise<void> {
  // LiveKit keys — required, no prompting
  const livekitKeys = ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"] as const;
  const missing = livekitKeys.filter((k) => !env(k));
  if (missing.length > 0) {
    p.log.error(
      `Missing LiveKit keys: ${missing.join(", ")}\n` +
        `  These come from your LiveKit Cloud project.\n` +
        `  Add them to .env and try again.`,
    );
    process.exit(1);
  }

  // Ganglia backend
  if (!env("GANGLIA_TYPE")) {
    const backend = await p.select({
      message: "Which brain backend?",
      options: [
        { value: "nanoclaw", label: "Nanoclaw", hint: "single-user, localhost" },
        { value: "openclaw", label: "OpenClaw", hint: "multi-user, requires API key" },
      ],
    });
    if (p.isCancel(backend)) cancelled();
    setKey("GANGLIA_TYPE", backend as string);
  }

  if (env("GANGLIA_TYPE") === "openclaw" && !env("OPENCLAW_API_KEY")) {
    const key = await p.password({ message: "Enter your OpenClaw API key:" });
    if (p.isCancel(key)) cancelled();
    setKey("OPENCLAW_API_KEY", key);
  }

  // Voice keys
  const voiceKeys = [
    { key: "DEEPGRAM_API_KEY", label: "Deepgram API key (STT)" },
    { key: "CARTESIA_API_KEY", label: "Cartesia API key (TTS)" },
  ] as const;

  for (const { key, label } of voiceKeys) {
    if (!env(key)) {
      const value = await p.password({ message: `Enter your ${label}:` });
      if (p.isCancel(value)) cancelled();
      setKey(key, value);
    }
  }
}

// ── Phase 2: Confirmation ────────────────────────────────────────────

async function confirm(): Promise<void> {
  const mask = (v: string | undefined) => (v ? "***" + v.slice(-4) : "(not set)");

  p.note(
    [
      `LiveKit URL:    ${env("LIVEKIT_URL")}`,
      `LiveKit Key:    ${mask(env("LIVEKIT_API_KEY"))}`,
      `Ganglia:        ${env("GANGLIA_TYPE")}`,
      `Deepgram:       ${mask(env("DEEPGRAM_API_KEY"))}`,
      `Cartesia:       ${mask(env("CARTESIA_API_KEY"))}`,
    ].join("\n"),
    "Configuration",
  );

  const ok = await p.confirm({ message: "Start services?" });
  if (p.isCancel(ok) || !ok) cancelled();
}

// ── Phase 3: Service Startup ─────────────────────────────────────────

const children: Subprocess[] = [];

async function runStep(label: string, cmd: string[]): Promise<void> {
  const s = p.spinner();
  s.start(label);

  const proc = spawn(cmd, { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  children.push(proc);

  const exitCode = await proc.exited;
  children.splice(children.indexOf(proc), 1);

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    s.stop(`${label} — failed (exit ${exitCode})`);
    if (stderr.trim()) p.log.error(stderr.trim());
    p.cancel("Service startup failed.");
    process.exit(1);
  }

  s.stop(`${label} — done`);
}

async function startServices(): Promise<Subprocess> {
  // 1. LiveKit infrastructure
  await runStep("Starting LiveKit server", ["bash", "./scripts/setup.sh"]);

  // 2. Token generation
  await runStep("Generating LiveKit token", ["bun", "run", "scripts/generate-token.ts"]);

  // 3. Voice agent (long-running — inherit stdout for real-time logs)
  p.log.info("Starting voice agent (logs below)...\n");

  const agent = spawn(["bun", "run", "scripts/voice-agent.ts", "dev"], {
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });
  children.push(agent);
  return agent;
}

// ── Phase 4: Steady State & Cleanup ──────────────────────────────────

function installShutdownHandler(agent: Subprocess): void {
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

// ── Main ─────────────────────────────────────────────────────────────

p.intro("Fletcher Dev Launcher");

await auditEnv();
await confirm();

const agent = await startServices();
installShutdownHandler(agent);

p.note("Voice agent is running. Press Ctrl+C to stop.", "Fletcher is ready");

await agent.exited;
p.outro("Voice agent exited.");
