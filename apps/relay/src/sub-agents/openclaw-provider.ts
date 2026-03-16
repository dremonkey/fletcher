/**
 * OpenClaw sub-agent provider.
 *
 * Passively captures sub-agent activity from ACP session/update events.
 * OpenClaw emits `tool_call` updates when the LLM invokes tools — some of
 * these are sub-agent spawns (Task tool). The provider watches for these
 * events and maintains a snapshot of active/completed sub-agents.
 *
 * This provider doesn't make any extra ACP requests — it hooks into the
 * update stream that already flows through RelayBridge.
 */

import type { SubAgentProvider, SubAgentUpdateCallback } from "./provider";
import type { SubAgentInfo, SubAgentStatus } from "./types";
import type { Logger } from "../utils/logger";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_TASK_LENGTH = 120;
const MAX_OUTPUT_LENGTH = 200;

/** Tool names that indicate sub-agent spawns in OpenClaw. */
const SUB_AGENT_TOOL_NAMES = new Set(["Task", "task", "subagent", "sub_agent"]);

/** Timeout after which a running sub-agent without updates is marked as timeout (ms). */
const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 3) + "...";
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class OpenClawProvider implements SubAgentProvider {
  readonly name = "openclaw";

  private log: Logger;
  private callback: SubAgentUpdateCallback | null = null;
  private agents = new Map<string, SubAgentInfo>();
  private timeoutTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: { sessionId: string; cwd: string; logger: Logger }) {
    this.log = opts.logger;
  }

  start(onUpdate: SubAgentUpdateCallback): void {
    this.callback = onUpdate;
    this.log.info({ event: "openclaw_provider_start" }, "OpenClaw sub-agent provider started");

    // Periodic check for timed-out agents
    this.timeoutTimer = setInterval(() => this.checkTimeouts(), 10_000);
  }

  stop(): void {
    this.callback = null;
    if (this.timeoutTimer) {
      clearInterval(this.timeoutTimer);
      this.timeoutTimer = null;
    }
  }

  getSnapshot(): SubAgentInfo[] {
    return Array.from(this.agents.values());
  }

  /**
   * Feed an ACP session/update event into the provider.
   * Called by RelayBridge when it receives updates from the ACP subprocess.
   */
  handleSessionUpdate(params: unknown): void {
    if (!params || typeof params !== "object") return;

    const update = (params as any).update;
    if (!update || typeof update !== "object") return;

    const updateKind = update.sessionUpdate as string | undefined;
    if (!updateKind) return;

    if (updateKind === "tool_call_begin") {
      this.handleToolCallBegin(update);
    } else if (updateKind === "tool_call_end") {
      this.handleToolCallEnd(update);
    } else if (updateKind === "subagent_start") {
      this.handleSubAgentStart(update);
    } else if (updateKind === "subagent_end") {
      this.handleSubAgentEnd(update);
    }
  }

  // -----------------------------------------------------------------------
  // Event handlers
  // -----------------------------------------------------------------------

  private handleToolCallBegin(update: any): void {
    const toolName = update.tool_name ?? update.name;
    if (!toolName || !SUB_AGENT_TOOL_NAMES.has(toolName)) return;

    const id = update.tool_call_id ?? update.id ?? crypto.randomUUID();
    const task = this.extractTaskFromInput(update.input);
    const now = Date.now();

    this.agents.set(id, {
      id,
      task: truncate(task, MAX_TASK_LENGTH),
      status: "running",
      startedAt: now,
      lastActivityAt: now,
      completedAt: null,
      durationMs: 0,
    });

    this.log.debug({ event: "openclaw_subagent_start", id, task }, "sub-agent started");
    this.notify();
  }

  private handleToolCallEnd(update: any): void {
    const id = update.tool_call_id ?? update.id;
    if (!id) return;

    const agent = this.agents.get(id);
    if (!agent) return;

    const now = Date.now();
    const output = typeof update.output === "string" ? update.output : undefined;

    this.agents.set(id, {
      ...agent,
      status: update.error ? "error" : "completed",
      lastActivityAt: now,
      completedAt: now,
      durationMs: now - agent.startedAt,
      lastOutput: output ? truncate(output, MAX_OUTPUT_LENGTH) : agent.lastOutput,
    });

    this.log.debug({ event: "openclaw_subagent_end", id }, "sub-agent completed");
    this.notify();
  }

  private handleSubAgentStart(update: any): void {
    const id = update.agent_id ?? update.id ?? crypto.randomUUID();
    const task = update.task ?? update.description ?? "(unknown task)";
    const now = Date.now();

    this.agents.set(id, {
      id,
      task: truncate(task, MAX_TASK_LENGTH),
      status: "running",
      startedAt: now,
      lastActivityAt: now,
      completedAt: null,
      durationMs: 0,
      model: update.model,
    });

    this.log.debug({ event: "openclaw_subagent_start", id, task }, "sub-agent started");
    this.notify();
  }

  private handleSubAgentEnd(update: any): void {
    const id = update.agent_id ?? update.id;
    if (!id) return;

    const agent = this.agents.get(id);
    if (!agent) return;

    const now = Date.now();
    this.agents.set(id, {
      ...agent,
      status: update.error ? "error" : "completed",
      lastActivityAt: now,
      completedAt: now,
      durationMs: now - agent.startedAt,
      lastOutput: update.output
        ? truncate(String(update.output), MAX_OUTPUT_LENGTH)
        : agent.lastOutput,
    });

    this.log.debug({ event: "openclaw_subagent_end", id }, "sub-agent ended");
    this.notify();
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  private extractTaskFromInput(input: unknown): string {
    if (!input || typeof input !== "object") return "(unknown task)";
    const obj = input as Record<string, unknown>;
    // Common field names for the task/prompt
    for (const key of ["prompt", "task", "description", "message"]) {
      if (typeof obj[key] === "string" && obj[key]) return obj[key] as string;
    }
    return "(unknown task)";
  }

  private checkTimeouts(): void {
    const now = Date.now();
    let changed = false;

    for (const [id, agent] of this.agents) {
      if (agent.status === "running" && now - agent.lastActivityAt > TIMEOUT_MS) {
        this.agents.set(id, {
          ...agent,
          status: "timeout",
          completedAt: now,
          durationMs: now - agent.startedAt,
        });
        changed = true;
        this.log.debug({ event: "openclaw_subagent_timeout", id }, "sub-agent timed out");
      }
    }

    if (changed) this.notify();
  }

  private notify(): void {
    this.callback?.(this.getSnapshot());
  }
}
