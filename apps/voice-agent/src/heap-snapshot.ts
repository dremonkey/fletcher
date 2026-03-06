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

const DEFAULT_RSS_THRESHOLD_MB = 1024; // 1 GB
const MONITOR_INTERVAL_MS = 30_000;    // 30 seconds

function writeSnapshot(logger: Logger, reason: string): string | null {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const path = `/tmp/fletcher-heap-${timestamp}.heapsnapshot`;
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
  const thresholdMb = Number(process.env.FLETCHER_HEAP_THRESHOLD_MB) || DEFAULT_RSS_THRESHOLD_MB;
  let autoSnapshotTaken = false;

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

    if (rssMb > thresholdMb) {
      logger.warn(
        { rssMb, heapUsedMb, heapTotalMb, thresholdMb },
        'Memory usage exceeds threshold',
      );
      if (!autoSnapshotTaken) {
        autoSnapshotTaken = true;
        writeSnapshot(logger, `RSS ${rssMb}MB exceeded threshold ${thresholdMb}MB`);
      }
    } else {
      logger.debug({ rssMb, heapUsedMb, heapTotalMb }, 'Memory usage');
    }
  }, MONITOR_INTERVAL_MS);

  // Don't prevent process exit
  interval.unref();

  logger.info(
    { thresholdMb, intervalMs: MONITOR_INTERVAL_MS },
    'Heap diagnostics initialized (SIGUSR1 for manual snapshot)',
  );
}
