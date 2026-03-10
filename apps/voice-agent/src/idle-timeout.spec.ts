import { describe, it, expect, beforeEach, afterEach, jest } from 'bun:test';
import { IdleTimeout, readIdleTimeoutConfig, type IdleTimeoutOptions } from './idle-timeout';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build IdleTimeoutOptions with sensible test defaults and spy callbacks */
function buildOpts(overrides: Partial<IdleTimeoutOptions> = {}): IdleTimeoutOptions & {
  onWarning: ReturnType<typeof jest.fn>;
  onWarmDown: ReturnType<typeof jest.fn>;
  onTimeout: ReturnType<typeof jest.fn>;
} {
  const onWarning = jest.fn();
  const onWarmDown = jest.fn();
  const onTimeout = jest.fn();
  return {
    timeoutMs: 10_000,
    warningMs: 3_000,
    warmDownMs: 5_000,
    onWarning,
    onWarmDown,
    onTimeout,
    logger: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as IdleTimeoutOptions['logger'],
    ...overrides,
    // Ensure spies are always fresh even if overrides provided functions
    ...(overrides.onWarning ? {} : { onWarning }),
    ...(overrides.onWarmDown ? {} : { onWarmDown }),
    ...(overrides.onTimeout ? {} : { onTimeout }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IdleTimeout', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Core timer behavior
  // -------------------------------------------------------------------------

  it('fires onWarmDown at timeoutMs and onTimeout at timeoutMs + warmDownMs', () => {
    const opts = buildOpts({ timeoutMs: 5_000, warningMs: 1_000, warmDownMs: 3_000 });
    const idle = new IdleTimeout(opts);
    idle.reset();

    // Not yet at timeout
    jest.advanceTimersByTime(4_999);
    expect(opts.onWarmDown).not.toHaveBeenCalled();
    expect(opts.onTimeout).not.toHaveBeenCalled();

    // At timeoutMs — warm-down starts
    jest.advanceTimersByTime(1);
    expect(opts.onWarmDown).toHaveBeenCalledTimes(1);
    expect(opts.onTimeout).not.toHaveBeenCalled();

    // During warm-down
    jest.advanceTimersByTime(2_999);
    expect(opts.onTimeout).not.toHaveBeenCalled();

    // At timeoutMs + warmDownMs — full disconnect
    jest.advanceTimersByTime(1);
    expect(opts.onTimeout).toHaveBeenCalledTimes(1);
  });

  it('fires onTimeout directly at timeoutMs when warmDownMs === 0 (no warm-down)', () => {
    const opts = buildOpts({ timeoutMs: 5_000, warningMs: 1_000, warmDownMs: 0 });
    const idle = new IdleTimeout(opts);
    idle.reset();

    // Not yet at timeout
    jest.advanceTimersByTime(4_999);
    expect(opts.onTimeout).not.toHaveBeenCalled();

    // Exactly at timeout — direct disconnect, no warm-down
    jest.advanceTimersByTime(1);
    expect(opts.onWarmDown).not.toHaveBeenCalled();
    expect(opts.onTimeout).toHaveBeenCalledTimes(1);
  });

  it('fires onWarning at (timeoutMs - warningMs) before onWarmDown', () => {
    const opts = buildOpts({ timeoutMs: 10_000, warningMs: 3_000, warmDownMs: 5_000 });
    const idle = new IdleTimeout(opts);
    idle.reset();

    // Not yet at warning
    jest.advanceTimersByTime(6_999);
    expect(opts.onWarning).not.toHaveBeenCalled();

    // At warning time (10000 - 3000 = 7000ms)
    jest.advanceTimersByTime(1);
    expect(opts.onWarning).toHaveBeenCalledTimes(1);
    expect(opts.onWarning).toHaveBeenCalledWith(3_000);

    // onWarmDown not yet
    expect(opts.onWarmDown).not.toHaveBeenCalled();

    // Advance to timeout — warm-down starts
    jest.advanceTimersByTime(3_000);
    expect(opts.onWarmDown).toHaveBeenCalledTimes(1);

    // Advance to full disconnect
    jest.advanceTimersByTime(5_000);
    expect(opts.onTimeout).toHaveBeenCalledTimes(1);
  });

  it('does not fire onWarning when warningMs >= timeoutMs', () => {
    const opts = buildOpts({ timeoutMs: 5_000, warningMs: 5_000, warmDownMs: 2_000 });
    const idle = new IdleTimeout(opts);
    idle.reset();

    // warningDelay = 5000 - 5000 = 0, not > 0, so no warning timer
    jest.advanceTimersByTime(5_000);
    expect(opts.onWarning).not.toHaveBeenCalled();
    expect(opts.onWarmDown).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(2_000);
    expect(opts.onTimeout).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // inWarmDown state
  // -------------------------------------------------------------------------

  it('reports inWarmDown correctly during lifecycle', () => {
    const opts = buildOpts({ timeoutMs: 5_000, warningMs: 1_000, warmDownMs: 3_000 });
    const idle = new IdleTimeout(opts);
    idle.reset();

    expect(idle.inWarmDown).toBe(false);

    // Enter warm-down
    jest.advanceTimersByTime(5_000);
    expect(idle.inWarmDown).toBe(true);

    // After full disconnect
    jest.advanceTimersByTime(3_000);
    expect(idle.inWarmDown).toBe(false);
  });

  // -------------------------------------------------------------------------
  // reset() behavior
  // -------------------------------------------------------------------------

  it('reset() restarts the timer', () => {
    const opts = buildOpts({ timeoutMs: 5_000, warningMs: 1_000, warmDownMs: 0 });
    const idle = new IdleTimeout(opts);
    idle.reset();

    // Advance 3s (partial)
    jest.advanceTimersByTime(3_000);
    expect(opts.onTimeout).not.toHaveBeenCalled();

    // Reset — timer restarts from 0
    idle.reset();

    // Advance another 3s (total 6s from start, but only 3s from reset)
    jest.advanceTimersByTime(3_000);
    expect(opts.onTimeout).not.toHaveBeenCalled();

    // Advance to 5s from reset
    jest.advanceTimersByTime(2_000);
    expect(opts.onTimeout).toHaveBeenCalledTimes(1);
  });

  it('reset() also restarts the warning timer', () => {
    const opts = buildOpts({ timeoutMs: 10_000, warningMs: 2_000, warmDownMs: 0 });
    const idle = new IdleTimeout(opts);
    idle.reset();

    // Advance to just before warning (8000ms)
    jest.advanceTimersByTime(7_500);
    expect(opts.onWarning).not.toHaveBeenCalled();

    // Reset — warning timer restarts
    idle.reset();

    // Advance 7500ms again from reset — still before new warning at 8000ms
    jest.advanceTimersByTime(7_500);
    expect(opts.onWarning).not.toHaveBeenCalled();

    // Hit the new warning point
    jest.advanceTimersByTime(500);
    expect(opts.onWarning).toHaveBeenCalledTimes(1);
  });

  it('reset() during warm-down restarts the full cycle', () => {
    const opts = buildOpts({ timeoutMs: 5_000, warningMs: 1_000, warmDownMs: 3_000 });
    const idle = new IdleTimeout(opts);
    idle.reset();

    // Warning fires at 4000ms (5000 - 1000)
    jest.advanceTimersByTime(4_000);
    expect(opts.onWarning).toHaveBeenCalledTimes(1);

    // Enter warm-down at 5000ms
    jest.advanceTimersByTime(1_000);
    expect(opts.onWarmDown).toHaveBeenCalledTimes(1);
    expect(idle.inWarmDown).toBe(true);

    // Reset during warm-down — full restart
    idle.reset();
    expect(idle.inWarmDown).toBe(false);

    // The warm-down timer should be cancelled — no onTimeout from old cycle
    jest.advanceTimersByTime(3_000);
    expect(opts.onTimeout).not.toHaveBeenCalled();

    // New cycle: warning at 4000ms from reset
    jest.advanceTimersByTime(1_000); // 4000ms from reset
    expect(opts.onWarning).toHaveBeenCalledTimes(2); // once from first cycle + once from new

    // Warm-down at 5000ms from reset
    jest.advanceTimersByTime(1_000); // 5000ms from reset
    expect(opts.onWarmDown).toHaveBeenCalledTimes(2);

    // Full disconnect at 5000 + 3000 = 8000ms from reset
    jest.advanceTimersByTime(3_000);
    expect(opts.onTimeout).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // stop() behavior
  // -------------------------------------------------------------------------

  it('stop() prevents future fires', () => {
    const opts = buildOpts({ timeoutMs: 5_000, warningMs: 1_000, warmDownMs: 3_000 });
    const idle = new IdleTimeout(opts);
    idle.reset();

    // Stop before timeout
    jest.advanceTimersByTime(2_000);
    idle.stop();

    // Advance well past timeout + warm-down
    jest.advanceTimersByTime(20_000);
    expect(opts.onWarning).not.toHaveBeenCalled();
    expect(opts.onWarmDown).not.toHaveBeenCalled();
    expect(opts.onTimeout).not.toHaveBeenCalled();
  });

  it('stop() during warm-down prevents onTimeout', () => {
    const opts = buildOpts({ timeoutMs: 5_000, warningMs: 1_000, warmDownMs: 3_000 });
    const idle = new IdleTimeout(opts);
    idle.reset();

    // Enter warm-down
    jest.advanceTimersByTime(5_000);
    expect(opts.onWarmDown).toHaveBeenCalledTimes(1);

    // Stop during warm-down
    idle.stop();
    expect(idle.inWarmDown).toBe(false);

    // Advance past warm-down expiry
    jest.advanceTimersByTime(10_000);
    expect(opts.onTimeout).not.toHaveBeenCalled();
  });

  it('stop() prevents reset() from restarting timers', () => {
    const opts = buildOpts({ timeoutMs: 5_000, warningMs: 1_000, warmDownMs: 3_000 });
    const idle = new IdleTimeout(opts);
    idle.stop();

    // Attempt to reset after stop — should be a no-op
    idle.reset();
    jest.advanceTimersByTime(20_000);
    expect(opts.onTimeout).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // disabled behavior
  // -------------------------------------------------------------------------

  it('reports disabled when timeoutMs === 0', () => {
    const opts = buildOpts({ timeoutMs: 0 });
    const idle = new IdleTimeout(opts);
    expect(idle.disabled).toBe(true);
  });

  it('reports enabled when timeoutMs > 0', () => {
    const opts = buildOpts({ timeoutMs: 1_000 });
    const idle = new IdleTimeout(opts);
    expect(idle.disabled).toBe(false);
  });

  it('reset() is a no-op when disabled', () => {
    const opts = buildOpts({ timeoutMs: 0, warningMs: 0, warmDownMs: 0 });
    const idle = new IdleTimeout(opts);
    idle.reset();
    jest.advanceTimersByTime(1_000_000);
    expect(opts.onWarning).not.toHaveBeenCalled();
    expect(opts.onWarmDown).not.toHaveBeenCalled();
    expect(opts.onTimeout).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// readIdleTimeoutConfig
// ---------------------------------------------------------------------------

describe('readIdleTimeoutConfig', () => {
  afterEach(() => {
    // Restore env
    delete process.env.FLETCHER_IDLE_TIMEOUT_MS;
    delete process.env.FLETCHER_IDLE_WARNING_MS;
    delete process.env.FLETCHER_WARM_DOWN_MS;
  });

  it('reads from environment variables', () => {
    process.env.FLETCHER_IDLE_TIMEOUT_MS = '60000';
    process.env.FLETCHER_IDLE_WARNING_MS = '10000';
    process.env.FLETCHER_WARM_DOWN_MS = '30000';

    const config = readIdleTimeoutConfig();
    expect(config.timeoutMs).toBe(60_000);
    expect(config.warningMs).toBe(10_000);
    expect(config.warmDownMs).toBe(30_000);
  });

  it('uses defaults when env vars are missing', () => {
    delete process.env.FLETCHER_IDLE_TIMEOUT_MS;
    delete process.env.FLETCHER_IDLE_WARNING_MS;
    delete process.env.FLETCHER_WARM_DOWN_MS;

    const config = readIdleTimeoutConfig();
    expect(config.timeoutMs).toBe(300_000);
    expect(config.warningMs).toBe(30_000);
    expect(config.warmDownMs).toBe(60_000);
  });

  it('uses defaults when env vars are non-numeric', () => {
    process.env.FLETCHER_IDLE_TIMEOUT_MS = 'not-a-number';
    process.env.FLETCHER_IDLE_WARNING_MS = 'also-not';
    process.env.FLETCHER_WARM_DOWN_MS = 'nope';

    const config = readIdleTimeoutConfig();
    expect(config.timeoutMs).toBe(300_000);
    expect(config.warningMs).toBe(30_000);
    expect(config.warmDownMs).toBe(60_000);
  });

  it('allows 0 to disable idle timeout', () => {
    process.env.FLETCHER_IDLE_TIMEOUT_MS = '0';
    process.env.FLETCHER_IDLE_WARNING_MS = '0';

    const config = readIdleTimeoutConfig();
    expect(config.timeoutMs).toBe(0);
    expect(config.warningMs).toBe(0);
  });

  it('allows 0 to disable warm-down', () => {
    process.env.FLETCHER_WARM_DOWN_MS = '0';

    const config = readIdleTimeoutConfig();
    expect(config.warmDownMs).toBe(0);
  });

  it('reads FLETCHER_WARM_DOWN_MS from env', () => {
    process.env.FLETCHER_WARM_DOWN_MS = '120000';

    const config = readIdleTimeoutConfig();
    expect(config.warmDownMs).toBe(120_000);
  });
});
