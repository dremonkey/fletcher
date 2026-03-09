/**
 * Idle timeout — disconnect the agent after a configurable period of silence.
 *
 * The agent stays connected indefinitely by default, burning costs even when
 * nobody is speaking.  This module provides a clean, testable timer that
 * fires a warning callback (e.g. data channel event) and then a timeout
 * callback (e.g. ctx.shutdown()) after prolonged inactivity.
 *
 * All LiveKit/agent dependencies are injected via constructor callbacks,
 * keeping this module unit-testable in isolation.
 *
 * Environment variables:
 *   FLETCHER_IDLE_TIMEOUT_MS  — total idle time before disconnect (ms).
 *                                0 = disabled.  Default: 300000 (5 min).
 *   FLETCHER_IDLE_WARNING_MS  — time before disconnect to send warning (ms).
 *                                Default: 30000 (30s).
 */

import type { Logger } from 'pino';

export interface IdleTimeoutOptions {
  /** Total idle time before disconnect (ms). 0 = disabled. Default: 300000 (5 min) */
  timeoutMs: number;
  /** Time before disconnect to send warning (ms). Default: 30000 (30s) */
  warningMs: number;
  /** Called when idle warning should be sent */
  onWarning: (disconnectInMs: number) => void;
  /** Called when idle timeout is reached and agent should disconnect */
  onTimeout: () => void;
  /** Logger instance */
  logger: Logger;
}

export class IdleTimeout {
  private idleTimer: Timer | null = null;
  private warningTimer: Timer | null = null;
  private readonly opts: IdleTimeoutOptions;
  private _stopped = false;

  constructor(opts: IdleTimeoutOptions) {
    this.opts = opts;
  }

  /** Returns true if idle timeout is disabled (timeoutMs === 0) */
  get disabled(): boolean {
    return this.opts.timeoutMs === 0;
  }

  /** Start or reset the idle timer. Call on every user activity. */
  reset(): void {
    if (this.disabled || this._stopped) return;
    this.clear();

    const warningDelay = this.opts.timeoutMs - this.opts.warningMs;

    if (warningDelay > 0) {
      this.warningTimer = setTimeout(() => {
        this.opts.onWarning(this.opts.warningMs);
      }, warningDelay);
    }

    this.idleTimer = setTimeout(() => {
      this.opts.logger.info('Idle timeout reached — shutting down to save costs');
      this.opts.onTimeout();
    }, this.opts.timeoutMs);
  }

  /** Stop all timers permanently */
  stop(): void {
    this._stopped = true;
    this.clear();
  }

  /** Clear timers without stopping permanently */
  private clear(): void {
    if (this.warningTimer) {
      clearTimeout(this.warningTimer);
      this.warningTimer = null;
    }
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }
}

/** Read idle timeout config from environment */
export function readIdleTimeoutConfig(): { timeoutMs: number; warningMs: number } {
  const timeoutMs = parseInt(process.env.FLETCHER_IDLE_TIMEOUT_MS ?? '300000', 10);
  const warningMs = parseInt(process.env.FLETCHER_IDLE_WARNING_MS ?? '30000', 10);
  return {
    timeoutMs: isNaN(timeoutMs) ? 300000 : timeoutMs,
    warningMs: isNaN(warningMs) ? 30000 : warningMs,
  };
}
