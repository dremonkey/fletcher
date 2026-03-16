/**
 * Claude Code sub-agent provider.
 *
 * Watches the Claude Code session's `subagents/` directory for JSONL files
 * that represent spawned sub-agents. Each file is parsed to extract the task
 * description (first user message) and status (last message stop_reason).
 *
 * Path convention:
 *   ~/.claude/projects/{projectId}/{sessionId}/subagents/agent-{agentId}.jsonl
 *
 * Where projectId = cwd with `/` replaced by `-`, prefixed with `-`.
 */

import { watch, type FSWatcher } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import type { SubAgentProvider, SubAgentUpdateCallback } from "./provider";
import type { SubAgentInfo, SubAgentStatus } from "./types";
import type { Logger } from "../utils/logger";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEBOUNCE_MS = 500;
const POLL_INTERVAL_MS = 2_000;
const MAX_TASK_LENGTH = 120;
const MAX_OUTPUT_LENGTH = 200;
const AGENT_FILE_PATTERN = /^agent-([a-f0-9]+)\.jsonl$/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute the Claude Code project ID from a working directory.
 * Convention: replace all `/` with `-`, prefix with `-`.
 * e.g. `/home/ahanyu/code/fletcher` → `-home-ahanyu-code-fletcher`
 */
export function computeProjectId(cwd: string): string {
  return cwd.replace(/\//g, "-");
}

/**
 * Compute the subagents directory path for a Claude Code session.
 */
export function subagentsDir(cwd: string, sessionId: string): string {
  const projectId = computeProjectId(cwd);
  return join(homedir(), ".claude", "projects", projectId, sessionId, "subagents");
}

/** Truncate a string to maxLen, appending "..." if truncated. */
function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 3) + "...";
}

// ---------------------------------------------------------------------------
// JSONL parsing
// ---------------------------------------------------------------------------

interface JournalEntry {
  type?: string;
  timestamp?: string;
  message?: {
    role?: string;
    content?: string | Array<{ type: string; text?: string; name?: string; input?: unknown }>;
    stop_reason?: string | null;
    model?: string;
    usage?: { output_tokens?: number; input_tokens?: number };
  };
}

/**
 * Parse a JSONL file into a SubAgentInfo.
 * Returns null if the file is empty or unparseable.
 */
export function parseAgentJSONL(
  agentId: string,
  content: string,
): SubAgentInfo | null {
  const lines = content.trim().split("\n").filter(Boolean);
  if (lines.length === 0) {
    // File exists but empty — agent just spawned
    return {
      id: agentId,
      task: "(starting...)",
      status: "running",
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      completedAt: null,
      durationMs: 0,
    };
  }

  let firstUserMessage: string | null = null;
  let lastAssistantText: string | null = null;
  let lastStopReason: string | null | undefined = undefined;
  let startedAt: number | null = null;
  let lastActivityAt: number | null = null;
  let model: string | undefined;
  let totalTokens = 0;

  for (const line of lines) {
    let entry: JournalEntry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    // Track timestamps
    const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : null;
    if (ts && !isNaN(ts)) {
      if (startedAt === null) startedAt = ts;
      lastActivityAt = ts;
    }

    // First user message → task description
    if (entry.type === "user" && !firstUserMessage && entry.message?.content) {
      const content = entry.message.content;
      if (typeof content === "string") {
        firstUserMessage = content;
      } else if (Array.isArray(content)) {
        const textParts = content
          .filter((p) => p.type === "text" && typeof p.text === "string")
          .map((p) => p.text!);
        if (textParts.length > 0) {
          firstUserMessage = textParts.join("");
        }
      }
    }

    // Track assistant messages
    if (entry.type === "assistant" && entry.message) {
      const msg = entry.message;

      // Model
      if (msg.model) model = msg.model;

      // Tokens
      if (msg.usage?.output_tokens) totalTokens += msg.usage.output_tokens;

      // Stop reason (may be null on intermediate chunks, or "end_turn"/"tool_use" on final)
      if (msg.stop_reason !== undefined) {
        lastStopReason = msg.stop_reason;
      }

      // Last text output
      if (msg.content) {
        const content = msg.content;
        if (typeof content === "string") {
          lastAssistantText = content;
        } else if (Array.isArray(content)) {
          const textParts = content
            .filter((p) => p.type === "text" && typeof p.text === "string")
            .map((p) => p.text!);
          if (textParts.length > 0) {
            lastAssistantText = textParts.join("");
          }
        }
      }
    }
  }

  const now = Date.now();
  startedAt = startedAt ?? now;
  lastActivityAt = lastActivityAt ?? now;

  // Infer status from last stop_reason
  let status: SubAgentStatus;
  if (lastStopReason === "end_turn") {
    status = "completed";
  } else if (lastStopReason === null || lastStopReason === "tool_use") {
    status = "running";
  } else if (lastStopReason === undefined) {
    // No assistant messages yet
    status = "running";
  } else {
    // Unknown stop_reason — treat as running
    status = "running";
  }

  const completedAt = status === "completed" ? lastActivityAt : null;

  return {
    id: agentId,
    task: truncate(firstUserMessage ?? "(unknown task)", MAX_TASK_LENGTH),
    status,
    startedAt,
    lastActivityAt,
    completedAt,
    durationMs: (completedAt ?? now) - startedAt,
    model,
    tokens: totalTokens > 0 ? totalTokens : undefined,
    lastOutput: lastAssistantText
      ? truncate(lastAssistantText, MAX_OUTPUT_LENGTH)
      : undefined,
  };
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class ClaudeCodeProvider implements SubAgentProvider {
  readonly name = "claude";

  private dir: string;
  private log: Logger;
  private callback: SubAgentUpdateCallback | null = null;
  private agents = new Map<string, SubAgentInfo>();
  private watcher: FSWatcher | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(opts: { sessionId: string; cwd: string; logger: Logger }) {
    this.dir = subagentsDir(opts.cwd, opts.sessionId);
    this.log = opts.logger;
  }

  start(onUpdate: SubAgentUpdateCallback): void {
    this.callback = onUpdate;
    this.stopped = false;
    this.log.info({ event: "claude_provider_start", dir: this.dir }, "watching for sub-agents");
    this.tryWatch();
  }

  stop(): void {
    this.stopped = true;
    this.callback = null;
    this.watcher?.close();
    this.watcher = null;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  getSnapshot(): SubAgentInfo[] {
    return Array.from(this.agents.values());
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  private async tryWatch(): Promise<void> {
    if (this.stopped) return;

    // Check if the directory exists yet
    try {
      await stat(this.dir);
    } catch {
      // Directory doesn't exist — poll until it does
      this.log.debug(
        { event: "claude_provider_polling", dir: this.dir },
        "subagents dir not found, polling",
      );
      this.pollTimer = setInterval(() => this.tryWatch(), POLL_INTERVAL_MS);
      return;
    }

    // Directory exists — stop polling and start watching
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    try {
      this.watcher = watch(this.dir, (_eventType, filename) => {
        if (filename && AGENT_FILE_PATTERN.test(filename)) {
          this.debounceScan();
        }
      });
      this.watcher.on("error", (err) => {
        this.log.warn({ event: "claude_watcher_error", error: err.message }, "watcher error");
      });
    } catch (err) {
      this.log.warn(
        { event: "claude_watch_failed", error: (err as Error).message },
        "fs.watch failed, falling back to polling",
      );
      this.pollTimer = setInterval(() => this.scanDirectory(), POLL_INTERVAL_MS);
    }

    // Initial scan
    await this.scanDirectory();
  }

  private debounceScan(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.scanDirectory(), DEBOUNCE_MS);
  }

  private async scanDirectory(): Promise<void> {
    if (this.stopped) return;

    let files: string[];
    try {
      files = await readdir(this.dir);
    } catch {
      return; // Directory might have been removed
    }

    const agentFiles = files.filter((f) => AGENT_FILE_PATTERN.test(f));
    let changed = false;

    for (const filename of agentFiles) {
      const match = filename.match(AGENT_FILE_PATTERN);
      if (!match) continue;
      const agentId = match[1];

      try {
        const content = await readFile(join(this.dir, filename), "utf-8");
        const info = parseAgentJSONL(agentId, content);
        if (!info) continue;

        const existing = this.agents.get(agentId);
        // Only mark as changed if this is new or status/activity changed
        if (
          !existing ||
          existing.status !== info.status ||
          existing.lastActivityAt !== info.lastActivityAt
        ) {
          changed = true;
        }
        this.agents.set(agentId, info);
      } catch (err) {
        this.log.debug(
          { event: "claude_parse_error", agentId, error: (err as Error).message },
          "failed to parse agent JSONL",
        );
      }
    }

    if (changed && this.callback) {
      this.callback(this.getSnapshot());
    }
  }
}
