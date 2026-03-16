/**
 * Sub-agent visibility — shared data types.
 *
 * These types describe the state of backend sub-agents (Claude Code, OpenClaw)
 * and are used both internally (provider → relay bridge) and on the wire
 * (relay → Flutter via data channel).
 */

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export type SubAgentStatus = "running" | "completed" | "error" | "timeout";

// ---------------------------------------------------------------------------
// SubAgentInfo
// ---------------------------------------------------------------------------

export interface SubAgentInfo {
  /** Agent ID — typically a hash or UUID from the backend. */
  id: string;
  /** First user message (truncated) — describes what the sub-agent is working on. */
  task: string;
  /** Current lifecycle status. */
  status: SubAgentStatus;
  /** When the sub-agent was spawned (epoch ms). */
  startedAt: number;
  /** Last observed activity (epoch ms). */
  lastActivityAt: number;
  /** When the sub-agent finished, or null if still running. */
  completedAt: number | null;
  /** Wall-clock duration since spawn (ms). */
  durationMs: number;
  /** Model used by this sub-agent, if known. */
  model?: string;
  /** Total tokens consumed, if known. */
  tokens?: number;
  /** Truncated last assistant text (~200 chars). */
  lastOutput?: string;
}

// ---------------------------------------------------------------------------
// Wire message
// ---------------------------------------------------------------------------

export interface SubAgentSnapshot {
  type: "sub_agent_snapshot";
  agents: SubAgentInfo[];
}
