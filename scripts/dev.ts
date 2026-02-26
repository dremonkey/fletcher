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

const LIVEKIT_YAML = join(ROOT, "livekit.yaml");

function readLocalLiveKitConfig(): { url: string; key: string; secret: string } | null {
  try {
    const content = readFileSync(LIVEKIT_YAML, "utf-8");
    // Parse port
    const portMatch = content.match(/^port:\s*(\d+)/m);
    const port = portMatch ? portMatch[1] : "7880";
    // Parse first key/secret pair
    const keysMatch = content.match(/^keys:\s*\n\s+(\S+):\s*(\S+)/m);
    if (!keysMatch) return null;
    return { url: `ws://localhost:${port}`, key: keysMatch[1], secret: keysMatch[2] };
  } catch {
    return null;
  }
}

// Cloud credentials are stored under LIVEKIT_CLOUD_* so they survive
// switching to local and back.
const CLOUD_KEYS = {
  LIVEKIT_URL: "LIVEKIT_CLOUD_URL",
  LIVEKIT_API_KEY: "LIVEKIT_CLOUD_API_KEY",
  LIVEKIT_API_SECRET: "LIVEKIT_CLOUD_API_SECRET",
} as const;

function saveCloudKeys(): void {
  for (const [active, cloud] of Object.entries(CLOUD_KEYS)) {
    const val = env(active);
    if (val) setKey(cloud, val);
  }
}

function restoreCloudKeys(): boolean {
  const hasAll = Object.values(CLOUD_KEYS).every((k) => env(k));
  if (!hasAll) return false;
  for (const [active, cloud] of Object.entries(CLOUD_KEYS)) {
    setKey(active, env(cloud)!);
  }
  return true;
}

async function promptCloudKeys(): Promise<void> {
  for (const key of ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"] as const) {
    const cloudVal = env(CLOUD_KEYS[key]);
    if (cloudVal) {
      setKey(key, cloudVal);
    } else {
      const value = await p.text({ message: `Enter ${key}:` });
      if (p.isCancel(value)) cancelled();
      setKey(key, value);
    }
  }
  saveCloudKeys();
}

async function auditLiveKit(): Promise<void> {
  const hasAll = env("LIVEKIT_URL") && env("LIVEKIT_API_KEY") && env("LIVEKIT_API_SECRET");
  if (hasAll) return;

  const localConfig = readLocalLiveKitConfig();
  const hasCloudSaved = Object.values(CLOUD_KEYS).every((k) => env(k));

  const options: { value: string; label: string; hint?: string }[] = [];
  if (localConfig) {
    options.push({ value: "local", label: "Local", hint: localConfig.url });
  }
  if (hasCloudSaved) {
    options.push({ value: "cloud-saved", label: "LiveKit Cloud", hint: env(CLOUD_KEYS.LIVEKIT_URL) });
  }
  options.push({ value: "cloud-new", label: "LiveKit Cloud (new)", hint: "enter credentials" });

  const mode = await p.select({ message: "LiveKit server?", options });
  if (p.isCancel(mode)) cancelled();

  if (mode === "local" && localConfig) {
    // Save any existing cloud keys before overwriting
    saveCloudKeys();
    setKey("LIVEKIT_URL", localConfig.url);
    setKey("LIVEKIT_API_KEY", localConfig.key);
    setKey("LIVEKIT_API_SECRET", localConfig.secret);
  } else if (mode === "cloud-saved") {
    restoreCloudKeys();
  } else {
    await promptCloudKeys();
  }
}

async function auditEnv(): Promise<void> {
  await auditLiveKit();

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
    // Try to read the token from the OpenClaw config file
    const configPath = join(process.env.HOME || "~", ".openclaw", "openclaw.json");
    let autoToken: string | undefined;
    try {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      autoToken = config?.gateway?.auth?.token;
    } catch {}

    if (autoToken) {
      p.log.info(`Found gateway token in ${configPath}`);
      setKey("OPENCLAW_API_KEY", autoToken);
    } else {
      p.log.warn(
        `Could not read gateway token from ${configPath}\n` +
          "  Enter it manually below.",
      );
      const key = await p.password({ message: "Enter your OpenClaw gateway token:" });
      if (p.isCancel(key)) cancelled();
      setKey("OPENCLAW_API_KEY", key);
    }
  }

  // Voice keys
  const voiceKeys = [
    { key: "DEEPGRAM_API_KEY", label: "Deepgram API key (speech-to-text)" },
    { key: "CARTESIA_API_KEY", label: "Cartesia API key (text-to-speech)" },
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

function showConfig(): void {
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
}

async function modifyConfig(): Promise<void> {
  const key = await p.select({
    message: "Which key to change?",
    options: [
      { value: "livekit", label: "LiveKit server" },
      { value: "GANGLIA_TYPE", label: "Ganglia backend" },
      { value: "OPENCLAW_API_KEY", label: "OpenClaw gateway token" },
      { value: "DEEPGRAM_API_KEY", label: "Deepgram API key (speech-to-text)" },
      { value: "CARTESIA_API_KEY", label: "Cartesia API key (text-to-speech)" },
    ],
  });
  if (p.isCancel(key)) return;

  if (key === "livekit") {
    // Clear existing keys so auditLiveKit re-prompts
    delete process.env.LIVEKIT_URL;
    delete process.env.LIVEKIT_API_KEY;
    delete process.env.LIVEKIT_API_SECRET;
    await auditLiveKit();
  } else if (key === "GANGLIA_TYPE") {
    const backend = await p.select({
      message: "Which brain backend?",
      options: [
        { value: "nanoclaw", label: "Nanoclaw", hint: "single-user, localhost" },
        { value: "openclaw", label: "OpenClaw", hint: "multi-user, requires API key" },
      ],
    });
    if (p.isCancel(backend)) return;
    setKey("GANGLIA_TYPE", backend as string);
  } else {
    const value = await p.password({ message: `Enter new value:` });
    if (p.isCancel(value)) return;
    setKey(key as string, value);
  }
}

async function confirmOrModify(): Promise<void> {
  while (true) {
    showConfig();

    const action = await p.select({
      message: "What would you like to do?",
      options: [
        { value: "start", label: "Start services" },
        { value: "modify", label: "Modify config" },
      ],
    });
    if (p.isCancel(action)) cancelled();

    if (action === "start") return;
    await modifyConfig();
  }
}

// ── Phase 3: Service Startup ─────────────────────────────────────────

const children: Subprocess[] = [];

async function runStep(
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

async function startServices(): Promise<Subprocess> {
  // 1. LiveKit infrastructure (only for local server)
  if (isLocalLiveKit()) {
    await runStep("Starting LiveKit server", ["bash", "./scripts/setup.sh"]);
  }

  // 2. Token generation
  await runStep("Generating LiveKit token", ["bun", "run", "scripts/generate-token.ts"]);

  // 3. Voice agent — start with piped output to check for early crash
  const s = p.spinner();
  s.start("Starting voice agent");

  const agentMode = isLocalLiveKit() ? "dev" : "connect";
  const agentArgs = ["bun", "run", "scripts/voice-agent.ts", agentMode];
  if (agentMode === "connect") {
    agentArgs.push("--room", "fletcher-dev");
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

// ── Phase 4: Mobile Deploy (optional) ────────────────────────────────

interface AdbDevice {
  serial: string;
  status: string;
  description: string;
}

function hasCommand(name: string): boolean {
  try {
    const proc = Bun.spawnSync(["which", name], { stdout: "pipe", stderr: "pipe" });
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

function listAdbDevices(): AdbDevice[] {
  const proc = Bun.spawnSync(["adb", "devices", "-l"], { stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) return [];

  const output = proc.stdout.toString();
  const devices: AdbDevice[] = [];

  for (const line of output.split("\n")) {
    // Lines look like: "1A2B3C4D  device usb:1-1 product:raven model:Pixel_6_Pro ..."
    const match = line.match(/^(\S+)\s+(device|unauthorized|offline)\s*(.*)/);
    if (!match) continue;
    const [, serial, status, rest] = match;
    const modelMatch = rest.match(/model:(\S+)/);
    const description = modelMatch ? modelMatch[1].replace(/_/g, " ") : serial;
    devices.push({ serial, status, description });
  }

  return devices;
}

function getLanIp(): string | null {
  const proc = Bun.spawnSync(["hostname", "-I"], { stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) return null;
  const ip = proc.stdout.toString().trim().split(/\s+/)[0];
  return ip || null;
}

function updateMobileEnv(): void {
  const mobileEnvPath = join(ROOT, "apps", "mobile", ".env");
  let livekitUrl = env("LIVEKIT_URL") || "";

  // Replace localhost with LAN IP for physical devices
  if (livekitUrl.includes("localhost") || livekitUrl.includes("127.0.0.1")) {
    const lanIp = getLanIp();
    if (lanIp) {
      livekitUrl = livekitUrl.replace(/localhost|127\.0\.0\.1/, lanIp);
      p.log.info(`Mobile LIVEKIT_URL rewritten to ${livekitUrl}`);
    }
  }

  // Write to mobile .env using the same pattern as generate-token.ts
  const updateKey = (path: string, key: string, value: string) => {
    let content = "";
    if (existsSync(path)) content = readFileSync(path, "utf-8");
    const lines = content.split("\n");
    let found = false;
    const updated = lines.map((line) => {
      if (line.startsWith(`${key}=`)) { found = true; return `${key}=${value}`; }
      return line;
    });
    if (!found) updated.push(`${key}=${value}`);
    const result = updated.filter((l, i, a) => l !== "" || i < a.length - 1).join("\n") + "\n";
    writeFileSync(path, result);
  };

  updateKey(mobileEnvPath, "LIVEKIT_URL", livekitUrl);
}

async function deployToDevice(): Promise<void> {
  if (!hasCommand("adb") || !hasCommand("flutter")) return;

  const devices = listAdbDevices();
  const available = devices.filter((d) => d.status === "device");
  if (available.length === 0) return;

  let target: AdbDevice;

  if (available.length === 1) {
    const ok = await p.confirm({
      message: `Deploy to ${available[0].description} (${available[0].serial})?`,
    });
    if (p.isCancel(ok) || !ok) return;
    target = available[0];
  } else {
    const choice = await p.select({
      message: "Deploy to which device?",
      options: [
        ...available.map((d) => ({
          value: d.serial,
          label: d.description,
          hint: d.serial,
        })),
        { value: "__skip__", label: "Skip", hint: "don't deploy to a device" },
      ],
    });
    if (p.isCancel(choice)) return;
    if (choice === "__skip__") return;
    target = available.find((d) => d.serial === choice)!;
  }

  // Update mobile .env with correct LiveKit URL (LAN IP for local server)
  updateMobileEnv();

  // Build debug APK
  const mobileDir = join(ROOT, "apps", "mobile");
  const built = await runStep(
    "Building debug APK (this may take a while)",
    ["flutter", "build", "apk", "--debug"],
    { cwd: mobileDir, fatal: false },
  );
  if (!built) return;

  // Install to device
  const apkPath = join(mobileDir, "build", "app", "outputs", "flutter-apk", "app-debug.apk");
  await runStep(
    `Installing to ${target.description}`,
    ["adb", "-s", target.serial, "install", "-r", apkPath],
    { fatal: false },
  );
}

// ── Phase 5: Steady State & Cleanup ──────────────────────────────────

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
await confirmOrModify();

const agent = await startServices();
installShutdownHandler(agent);

await deployToDevice();

p.note("Voice agent is running. Press Ctrl+C to stop.", "Fletcher is ready");

// Pipe agent output to terminal now that clack UI is done
async function pipeStream(stream: ReadableStream<Uint8Array> | null, dest: NodeJS.WriteStream) {
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
pipeStream(agent.stdout as ReadableStream<Uint8Array>, process.stdout);
pipeStream(agent.stderr as ReadableStream<Uint8Array>, process.stderr);

await agent.exited;
p.outro("Voice agent exited.");
