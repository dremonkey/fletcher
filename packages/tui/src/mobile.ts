import * as p from "@clack/prompts";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { ROOT, env } from "./env";
import { runStep } from "./services";

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

function listAvds(): string[] {
  if (!hasCommand("emulator")) return [];
  const proc = Bun.spawnSync(["emulator", "-list-avds"], { stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) return [];
  return proc.stdout.toString().trim().split("\n").filter(Boolean);
}

/** Return AVD names of currently running emulators. */
function getRunningAvdNames(devices: AdbDevice[]): Set<string> {
  const names = new Set<string>();
  for (const d of devices) {
    if (d.serial.startsWith("emulator-") && d.status === "device") {
      const proc = Bun.spawnSync(
        ["adb", "-s", d.serial, "emu", "avd", "name"],
        { stdout: "pipe", stderr: "pipe" },
      );
      if (proc.exitCode === 0) {
        const name = proc.stdout.toString().trim().split("\n")[0];
        if (name && name !== "OK") names.add(name);
      }
    }
  }
  return names;
}

/** Find the next free emulator serial (emulator-5554, emulator-5556, ...). */
function nextEmulatorSerial(devices: AdbDevice[]): string {
  const used = new Set(
    devices
      .filter((d) => d.serial.startsWith("emulator-"))
      .map((d) => parseInt(d.serial.split("-")[1])),
  );
  let port = 5554;
  while (used.has(port)) port += 2;
  return `emulator-${port}`;
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

export async function deployToDevice(): Promise<void> {
  if (!hasCommand("adb")) {
    p.log.warn("adb not found — skipping mobile deploy. Install Android SDK or run inside nix develop.");
    return;
  }
  if (!hasCommand("flutter")) {
    p.log.warn("flutter not found — skipping mobile deploy. Install Flutter or run inside nix develop.");
    return;
  }

  const devices = listAdbDevices();
  const available = devices.filter((d) => d.status === "device");

  // Discover AVDs that aren't already running
  const allAvds = listAvds();
  const runningAvds = getRunningAvdNames(devices);
  const offlineAvds = allAvds.filter((a) => !runningAvds.has(a));

  // Nothing at all?
  if (available.length === 0 && offlineAvds.length === 0) {
    const unauthorized = devices.filter((d) => d.status === "unauthorized");
    if (unauthorized.length > 0) {
      p.log.warn(`Found ${unauthorized.length} unauthorized device(s) — accept the USB debugging prompt on the device.`);
    } else {
      p.log.warn("No Android devices or emulators available — skipping mobile deploy.");
    }
    return;
  }

  // Build unified option list: connected devices + offline AVDs
  interface DeployOption { value: string; label: string; hint?: string }
  const options: DeployOption[] = [];

  for (const d of available) {
    options.push({
      value: `device:${d.serial}`,
      label: d.description,
      hint: d.serial,
    });
  }
  for (const avd of offlineAvds) {
    options.push({
      value: `avd:${avd}`,
      label: `Start ${avd} emulator`,
      hint: "not running",
    });
  }

  let selection: string;

  if (options.length === 1) {
    // Single option — confirm instead of a select menu
    const opt = options[0];
    const msg = opt.value.startsWith("avd:")
      ? `No devices connected. Start ${offlineAvds[0]} emulator and deploy?`
      : `Deploy to ${opt.label} (${opt.hint})?`;
    const ok = await p.confirm({ message: msg });
    if (p.isCancel(ok) || !ok) return;
    selection = opt.value;
  } else {
    options.push({ value: "__skip__", label: "Skip", hint: "don't deploy" });
    const choice = await p.select({
      message: "Deploy to which device?",
      options,
    });
    if (p.isCancel(choice)) return;
    if (choice === "__skip__") return;
    selection = choice as string;
  }

  // Update mobile .env with correct LiveKit URL (LAN IP for local server)
  updateMobileEnv();

  if (selection.startsWith("avd:")) {
    const avdName = selection.slice(4);
    const serial = nextEmulatorSerial(devices);
    await runStep(
      `Starting emulator (${avdName}) and deploying`,
      ["bash", join(ROOT, "scripts", "ensure-mobile-ready.sh"),
       "--device-id", serial, "--avd-name", avdName, "--skip-launch"],
      { fatal: false },
    );
  } else {
    const serial = selection.slice("device:".length);
    await runStep(
      "Building and installing APK",
      ["bash", join(ROOT, "scripts", "ensure-mobile-ready.sh"),
       "--device-id", serial, "--skip-launch"],
      { fatal: false },
    );
  }
}
