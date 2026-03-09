import { describe, it, expect, beforeEach, afterEach, jest } from 'bun:test';
import { IdleTimeout, readIdleTimeoutConfig, type IdleTimeoutOptions } from './idle-timeout';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build IdleTimeoutOptions with sensible test defaults and spy callbacks */
function buildOpts(overrides: Partial<IdleTimeoutOptions> = {}): IdleTimeoutOptions & {
  onWarning: ReturnType<typeof jest.fn>;
  onTimeout: ReturnType<typeof jest.fn>;
} {
  const onWarning = jest.fn();
  const onTimeout = jest.fn();
  return {
    timeoutMs: 10_000,
    warningMs: 3_000,
    onWarning,
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

  it('fires onTimeout after timeoutMs', () => {
    const opts = buildOpts({ timeoutMs: 5_000, warningMs: 1_000 });
    const idle = new IdleTimeout(opts);
    idle.reset();

    // Not yet at timeout
    jest.advanceTimersByTime(4_999);
    expect(opts.onTimeout).not.toHaveBeenCalled();

    // Exactly at timeout
    jest.advanceTimersByTime(1);
    expect(opts.onTimeout).toHaveBeenCalledTimes(1);
  });

  it('fires onWarning at (timeoutMs - warningMs) before onTimeout', () => {
    const opts = buildOpts({ timeoutMs: 10_000, warningMs: 3_000 });
    const idle = new IdleTimeout(opts);
    idle.reset();

    // Not yet at warning
    jest.advanceTimersByTime(6_999);
    expect(opts.onWarning).not.toHaveBeenCalled();

    // At warning time (10000 - 3000 = 7000ms)
    jest.advanceTimersByTime(1);
    expect(opts.onWarning).toHaveBeenCalledTimes(1);
    expect(opts.onWarning).toHaveBeenCalledWith(3_000);

    // onTimeout not yet
    expect(opts.onTimeout).not.toHaveBeenCalled();

    // Advance to timeout
    jest.advanceTimersByTime(3_000);
    expect(opts.onTimeout).toHaveBeenCalledTimes(1);
  });

  it('does not fire onWarning when warningMs >= timeoutMs', () => {
    const opts = buildOpts({ timeoutMs: 5_000, warningMs: 5_000 });
    const idle = new IdleTimeout(opts);
    idle.reset();

    // warningDelay = 5000 - 5000 = 0, not > 0, so no warning timer
    jest.advanceTimersByTime(5_000);
    expect(opts.onWarning).not.toHaveBeenCalled();
    expect(opts.onTimeout).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // reset() behavior
  // -------------------------------------------------------------------------

  it('reset() restarts the timer', () => {
    const opts = buildOpts({ timeoutMs: 5_000, warningMs: 1_000 });
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
    const opts = buildOpts({ timeoutMs: 10_000, warningMs: 2_000 });
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

  // -------------------------------------------------------------------------
  // stop() behavior
  // -------------------------------------------------------------------------

  it('stop() prevents future fires', () => {
    const opts = buildOpts({ timeoutMs: 5_000, warningMs: 1_000 });
    const idle = new IdleTimeout(opts);
    idle.reset();

    // Stop before timeout
    jest.advanceTimersByTime(2_000);
    idle.stop();

    // Advance well past timeout
    jest.advanceTimersByTime(10_000);
    expect(opts.onWarning).not.toHaveBeenCalled();
    expect(opts.onTimeout).not.toHaveBeenCalled();
  });

  it('stop() prevents reset() from restarting timers', () => {
    const opts = buildOpts({ timeoutMs: 5_000, warningMs: 1_000 });
    const idle = new IdleTimeout(opts);
    idle.stop();

    // Attempt to reset after stop — should be a no-op
    idle.reset();
    jest.advanceTimersByTime(10_000);
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
    const opts = buildOpts({ timeoutMs: 0, warningMs: 0 });
    const idle = new IdleTimeout(opts);
    idle.reset();
    jest.advanceTimersByTime(1_000_000);
    expect(opts.onWarning).not.toHaveBeenCalled();
    expect(opts.onTimeout).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// readIdleTimeoutConfig
// ---------------------------------------------------------------------------

describe('readIdleTimeoutConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore env
    delete process.env.FLETCHER_IDLE_TIMEOUT_MS;
    delete process.env.FLETCHER_IDLE_WARNING_MS;
  });

  it('reads from environment variables', () => {
    process.env.FLETCHER_IDLE_TIMEOUT_MS = '60000';
    process.env.FLETCHER_IDLE_WARNING_MS = '10000';

    const config = readIdleTimeoutConfig();
    expect(config.timeoutMs).toBe(60_000);
    expect(config.warningMs).toBe(10_000);
  });

  it('uses defaults when env vars are missing', () => {
    delete process.env.FLETCHER_IDLE_TIMEOUT_MS;
    delete process.env.FLETCHER_IDLE_WARNING_MS;

    const config = readIdleTimeoutConfig();
    expect(config.timeoutMs).toBe(300_000);
    expect(config.warningMs).toBe(30_000);
  });

  it('uses defaults when env vars are non-numeric', () => {
    process.env.FLETCHER_IDLE_TIMEOUT_MS = 'not-a-number';
    process.env.FLETCHER_IDLE_WARNING_MS = 'also-not';

    const config = readIdleTimeoutConfig();
    expect(config.timeoutMs).toBe(300_000);
    expect(config.warningMs).toBe(30_000);
  });

  it('allows 0 to disable idle timeout', () => {
    process.env.FLETCHER_IDLE_TIMEOUT_MS = '0';
    process.env.FLETCHER_IDLE_WARNING_MS = '0';

    const config = readIdleTimeoutConfig();
    expect(config.timeoutMs).toBe(0);
    expect(config.warningMs).toBe(0);
  });
});
