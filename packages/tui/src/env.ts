import * as p from "@clack/prompts";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

export const ROOT = join(import.meta.dirname, "..", "..", "..");
export const ENV_PATH = join(ROOT, ".env");

export function loadEnv(): Record<string, string> {
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

export function appendToEnv(key: string, value: string): void {
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

export function setKey(key: string, value: string): void {
  appendToEnv(key, value);
  process.env[key] = value;
}

export function env(key: string): string | undefined {
  return process.env[key] || undefined;
}

export function cancelled(): never {
  p.cancel("Cancelled.");
  process.exit(0);
}
