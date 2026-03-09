/**
 * Idle timeout — disconnect the agent after a configurable period of silence.
 *
 * The agent stays connected indefinitely by default, burning costs even when
 * nobody is speaking.  This module provides a clean, testable timer that
 * fires a warning callback (e.g. data channel event) and then a timeout
 * callback (e.g. ctx.shutdown()) after prolonged inactivity.
 *
 * Supports an optional "warm-down" phase between idle timeout and full
 * disconnect.  During warm-down the agent stays connected (costs agent-minutes)
 * but eliminates cold-start latency if the user returns quickly.  The caller
 * controls side effects (disabling audio, publishing events) via callbacks.
 *
 * All LiveKit/agent dependencies are injected via constructor callbacks,
 * keeping this module unit-testable in isolation.
 *
 * Environment variables:
 *   FLETCHER_IDLE_TIMEOUT_MS  — total idle time before disconnect (ms).
 *                                0 = disabled.  Default: 300000 (5 min).
 *   FLETCHER_IDLE_WARNING_MS  — time before disconnect to send warning (ms).
 *                                Default: 30000 (30s).
 *   FLETCHER_WARM_DOWN_MS     — grace period after idle before full disconnect (ms).
 *                                0 = disabled (immediate disconnect).  Default: 60000 (1 min).
 */

import type { Logger } from 'pino';

export interface IdleTimeoutOptions {
  /** Total idle time before disconnect (ms). 0 = disabled. Default: 300000 (5 min) */
  timeoutMs: number;
  /** Time before disconnect to send warning (ms). Default: 30000 (30s) */
  warningMs: number;
  /** Grace period after idle timeout before full disconnect (ms). 0 = disabled. Default: 60000 (1 min) */
  warmDownMs: number;
  /** Called when idle warning should be sent */
  onWarning: (disconnectInMs: number) => void;
  /** Called when entering warm-down phase (disable audio, notify client) */
  onWarmDown: () => void;
  /** Called when warm-down expires (or immediately if warmDownMs === 0) and agent should disconnect */
  onTimeout: () => void;
  /** Logger instance */
  logger: Logger;
}

export class IdleTimeout {
  private idleTimer: Timer | null = null;
  private warningTimer: Timer | null = null;
  private warmDownTimer: Timer | null = null;
  private readonly opts: IdleTimeoutOptions;
  private _stopped = false;
  private _inWarmDown = false;

  constructor(opts: IdleTimeoutOptions) {
    this.opts = opts;
  }

  /** Returns true if idle timeout is disabled (timeoutMs === 0) */
  get disabled(): boolean {
    return this.opts.timeoutMs === 0;
  }

  /** Returns true if the timer is currently in the warm-down phase */
  get inWarmDown(): boolean {
    return this._inWarmDown;
  }

  /** Start or reset the idle timer. Call on every user activity. */
  reset(): void {
    if (this.disabled || this._stopped) return;
    this._inWarmDown = false;
    this.clear();

    const warningDelay = this.opts.timeoutMs - this.opts.warningMs;

    if (warningDelay > 0) {
      this.warningTimer = setTimeout(() => {
        this.opts.onWarning(this.opts.warningMs);
      }, warningDelay);
    }

    this.idleTimer = setTimeout(() => {
      if (this.opts.warmDownMs > 0) {
        // Enter warm-down phase — agent stays connected but audio input disabled
        this._inWarmDown = true;
        this.opts.logger.info({ warmDownMs: this.opts.warmDownMs }, 'Idle timeout reached — entering warm-down phase');
        this.opts.onWarmDown();

        this.warmDownTimer = setTimeout(() => {
          this.opts.logger.info('Warm-down expired — shutting down to save costs');
          this._inWarmDown = false;
          this.opts.onTimeout();
        }, this.opts.warmDownMs);
      } else {
        // No warm-down — disconnect immediately
        this.opts.logger.info('Idle timeout reached — shutting down to save costs');
        this.opts.onTimeout();
      }
    }, this.opts.timeoutMs);
  }

  /** Stop all timers permanently */
  stop(): void {
    this._stopped = true;
    this._inWarmDown = false;
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
    if (this.warmDownTimer) {
      clearTimeout(this.warmDownTimer);
      this.warmDownTimer = null;
    }
  }
}

/** Read idle timeout config from environment */
export function readIdleTimeoutConfig(): { timeoutMs: number; warningMs: number; warmDownMs: number } {
  const timeoutMs = parseInt(process.env.FLETCHER_IDLE_TIMEOUT_MS ?? '300000', 10);
  const warningMs = parseInt(process.env.FLETCHER_IDLE_WARNING_MS ?? '30000', 10);
  const warmDownMs = parseInt(process.env.FLETCHER_WARM_DOWN_MS ?? '60000', 10);
  return {
    timeoutMs: isNaN(timeoutMs) ? 300000 : timeoutMs,
    warningMs: isNaN(warningMs) ? 30000 : warningMs,
    warmDownMs: isNaN(warmDownMs) ? 60000 : warmDownMs,
  };
}
