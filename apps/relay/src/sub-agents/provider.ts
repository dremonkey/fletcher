/**
 * Sub-agent provider interface.
 *
 * Each backend (Claude Code, OpenClaw) implements this interface to expose
 * sub-agent visibility. The provider watches for sub-agent activity and
 * pushes full snapshots via the callback.
 */

import type { SubAgentInfo } from "./types";

/** Called whenever the sub-agent list changes. Receives a full snapshot. */
export type SubAgentUpdateCallback = (agents: SubAgentInfo[]) => void;

export interface SubAgentProvider {
  /** Human-readable provider name (e.g. "claude", "openclaw"). */
  readonly name: string;

  /**
   * Start watching for sub-agent activity.
   * The callback is invoked with a full snapshot whenever the list changes.
   */
  start(onUpdate: SubAgentUpdateCallback): void;

  /** Stop watching and clean up resources (file watchers, timers, etc.). */
  stop(): void;

  /** Return the current snapshot without triggering a callback. */
  getSnapshot(): SubAgentInfo[];
}
