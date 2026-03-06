/**
 * Heap snapshot & memory monitoring for diagnosing memory leaks.
 *
 * - SIGUSR1: Writes a heap snapshot to /tmp/fletcher-heap-<timestamp>.heapsnapshot
 * - Periodic RSS check (every 30s): logs memory usage at debug level,
 *   warns when RSS exceeds a threshold, and auto-captures a snapshot once.
 *
 * Usage:
 *   docker compose kill -s SIGUSR1 voice-agent   # manual snapshot
 *   Load .heapsnapshot files in Chrome DevTools → Memory tab → Load
 */

interface Logger {
  debug: (obj: Record<string, unknown>, msg: string) => void;
  warn: (obj: Record<string, unknown>, msg: string) => void;
  info: (obj: Record<string, unknown> | string, msg?: string) => void;
}

// Auto-snapshot at these RSS thresholds (MB). Each fires once.
const SNAPSHOT_THRESHOLDS_MB = [1024, 2048, 2560, 3072, 3584]; // 1, 2, 2.5, 3, 3.5 GB
const MONITOR_INTERVAL_MS = 30_000; // 30 seconds

function writeSnapshot(logger: Logger, reason: string): string | null {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dir = '/tmp/heap-snapshots';
    try { require('fs').mkdirSync(dir, { recursive: true }); } catch {}
    const path = `${dir}/fletcher-heap-${timestamp}.heapsnapshot`;
    const snapshot = Bun.generateHeapSnapshot();
    Bun.write(path, JSON.stringify(snapshot));
    logger.info({ path, reason }, 'Heap snapshot written');
    return path;
  } catch (err) {
    logger.warn({ error: String(err) }, 'Failed to write heap snapshot');
    return null;
  }
}

export function initHeapDiagnostics(logger: Logger): void {
  // Track which thresholds have fired
  const pendingThresholds = [...SNAPSHOT_THRESHOLDS_MB].sort((a, b) => a - b);
  let nextThresholdIndex = 0;

  // SIGUSR1 → manual heap snapshot
  process.on('SIGUSR1', () => {
    writeSnapshot(logger, 'SIGUSR1');
  });

  // Periodic memory monitoring
  const interval = setInterval(() => {
    const mem = process.memoryUsage();
    const rssMb = Math.round(mem.rss / 1024 / 1024);
    const heapUsedMb = Math.round(mem.heapUsed / 1024 / 1024);
    const heapTotalMb = Math.round(mem.heapTotal / 1024 / 1024);

    // Check if we've crossed the next threshold
    if (nextThresholdIndex < pendingThresholds.length && rssMb >= pendingThresholds[nextThresholdIndex]) {
      const thresholdMb = pendingThresholds[nextThresholdIndex];
      nextThresholdIndex++;
      const remaining = pendingThresholds.length - nextThresholdIndex;
      logger.warn(
        { rssMb, heapUsedMb, heapTotalMb, thresholdMb, remainingThresholds: remaining },
        `Memory threshold ${thresholdMb}MB crossed — capturing snapshot`,
      );
      writeSnapshot(logger, `RSS ${rssMb}MB crossed ${thresholdMb}MB threshold`);
    } else if (rssMb >= (pendingThresholds[0] ?? Infinity)) {
      logger.warn({ rssMb, heapUsedMb, heapTotalMb }, 'Memory usage elevated');
    } else {
      logger.debug({ rssMb, heapUsedMb, heapTotalMb }, 'Memory usage');
    }
  }, MONITOR_INTERVAL_MS);

  // Don't prevent process exit
  interval.unref();

  logger.info(
    { thresholdsMb: pendingThresholds, intervalMs: MONITOR_INTERVAL_MS },
    'Heap diagnostics initialized (SIGUSR1 for manual snapshot)',
  );
}
