import * as p from "@clack/prompts";
import { readFileSync } from "fs";
import { join } from "path";
import { ROOT, env, setKey, cancelled } from "./env";

const LIVEKIT_YAML = join(ROOT, "livekit.yaml");

export const DEFAULT_ROOM = "fletcher-dev";

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

export async function auditLiveKit(): Promise<void> {
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

export async function auditEnv(): Promise<void> {
  await auditLiveKit();

  // Room name
  if (!env("LIVEKIT_ROOM")) {
    setKey("LIVEKIT_ROOM", DEFAULT_ROOM);
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
