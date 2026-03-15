/**
 * STT Health Watchdog — detects when the STT pipeline dies silently
 * and triggers recovery by disconnecting the agent from the room.
 *
 * ## Problem (BUG-027)
 *
 * The `@livekit/agents` SDK's AudioRecognition creates STT and VAD tasks
 * once during session startup.  When the STT stream reader is released
 * (e.g., during track resubscription, network glitches, or user-away
 * timeout), the `isStreamReaderReleaseError()` check silently swallows
 * the error and the task exits without notification.  No events are
 * emitted, no recovery is attempted.  The agent process stays alive but
 * produces zero STT/TTS output — a zombie state.
 *
 * ## Solution
 *
 * The watchdog monitors STT liveness by tracking the last time any
 * UserInputTranscribed event arrived.  If no activity is detected for
 * `timeoutMs` while the agent is in "listening" state (expecting audio),
 * the watchdog disconnects the room.  This triggers hold mode, which
 * gives the client a clean "tap to resume" recovery path.
 *
 * The watchdog only activates after the first STT event — before that,
 * the user may simply not be speaking (mic off, bootstrap in progress).
 *
 * ## Usage
 *
 * ```ts
 * const watchdog = createSttWatchdog({
 *   getAgentState: () => session.agentState,
 *   disconnectRoom: () => ctx.room.disconnect(),
 *   publishEvent,
 *   logger,
 * });
 *
 * // Hook into session events:
 * session.on(UserInputTranscribed, () => watchdog.onSttActivity());
 * session.on(AgentStateChanged, (ev) => {
 *   if (ev.newState === 'listening') watchdog.onAgentListening();
 *   else watchdog.onAgentBusy();
 * });
 *
 * // When bootstrap completes:
 * watchdog.activate();
 *
 * // On shutdown:
 * watchdog.dispose();
 * ```
 *
 * (BUG-027)
 */

export type AgentState =
  | "initializing"
  | "idle"
  | "listening"
  | "thinking"
  | "speaking";

export interface SttWatchdogDeps {
  /** Returns the current agent state from the session. */
  getAgentState: () => AgentState;
  /** Disconnects the room to trigger hold/reconnect flow. */
  disconnectRoom: () => void;
  /** Publishes a data channel event to the client. */
  publishEvent: (event: Record<string, unknown>) => void;
  /** Structured logger (pino-compatible). */
  logger: {
    info: (obj: Record<string, unknown>, msg: string) => void;
    warn: (obj: Record<string, unknown>, msg: string) => void;
    debug: (obj: Record<string, unknown>, msg: string) => void;
  };
}

export interface SttWatchdog {
  /**
   * Activate the watchdog.  Call after bootstrap completes and the
   * agent is ready to receive speech.  The watchdog does NOT start
   * the timeout clock until the first STT event — this avoids false
   * alarms when the user has their mic off or hasn't spoken yet.
   */
  activate(): void;

  /**
   * Record STT activity.  Call on every UserInputTranscribed event
   * (both interim and final).  Resets the silence clock.
   */
  onSttActivity(): void;

  /**
   * Notify the watchdog that the agent entered "listening" state.
   * The timeout clock only runs while the agent is listening.
   */
  onAgentListening(): void;

  /**
   * Notify the watchdog that the agent is busy (thinking, speaking,
   * initializing).  The timeout clock is paused.
   */
  onAgentBusy(): void;

  /** Stop the watchdog and release all timers. */
  dispose(): void;

  /** Whether the watchdog has been activated. */
  readonly activated: boolean;

  /** Whether STT has ever been active (at least one event received). */
  readonly sttEverActive: boolean;

  /** Timestamp (ms) of last STT activity, or 0 if none. */
  readonly lastActivityMs: number;
}

/** Default timeout: 30 seconds of silence while listening triggers recovery. */
export const DEFAULT_STT_WATCHDOG_TIMEOUT_MS = 30_000;

/** How often the watchdog checks for silence. */
export const WATCHDOG_CHECK_INTERVAL_MS = 10_000;

export function createSttWatchdog(
  deps: SttWatchdogDeps,
  timeoutMs: number = DEFAULT_STT_WATCHDOG_TIMEOUT_MS,
  checkIntervalMs: number = WATCHDOG_CHECK_INTERVAL_MS,
): SttWatchdog {
  let _activated = false;
  let _sttEverActive = false;
  let _lastActivityMs = 0;
  let _agentListening = false;
  let _listeningStartMs = 0;
  let _checkInterval: ReturnType<typeof setInterval> | null = null;
  let _disposed = false;
  let _holdSent = false;

  const startChecking = () => {
    if (_checkInterval || _disposed) return;
    _checkInterval = setInterval(check, checkIntervalMs);
  };

  const stopChecking = () => {
    if (_checkInterval) {
      clearInterval(_checkInterval);
      _checkInterval = null;
    }
  };

  const check = () => {
    // Only check when: activated, STT was active before, agent is listening
    if (!_activated || !_sttEverActive || !_agentListening) return;

    const now = Date.now();
    const silenceMs = now - _lastActivityMs;
    const listeningMs = now - _listeningStartMs;

    // The timeout must have elapsed since BOTH last activity AND since
    // we entered listening state.  This prevents false alarms when the
    // agent just finished speaking (transition to listening resets the
    // listening clock but STT activity may not have arrived yet).
    if (silenceMs >= timeoutMs && listeningMs >= timeoutMs) {
      deps.logger.warn(
        { silenceMs, timeoutMs, listeningMs },
        "STT watchdog: no STT activity detected — pipeline may be dead, triggering recovery",
      );

      // Disconnect to trigger hold mode → client shows "tap to resume"
      deps.disconnectRoom();

      // Stop checking after triggering recovery — the session is ending
      stopChecking();
      return;
    }

    // Send session_hold early — the data channel may die before the full
    // timeout elapses (DTLS timeout after track unpublish).  Send the hold
    // event on the first check that detects silence so the client gets it
    // while the transport is still alive.  The actual disconnect happens
    // later when the full timeout fires.
    if (!_holdSent && silenceMs >= checkIntervalMs && listeningMs >= checkIntervalMs) {
      deps.logger.info(
        { silenceMs, timeoutMs },
        "STT watchdog: sending early session_hold — data channel may degrade before timeout",
      );
      deps.publishEvent({
        type: "session_hold",
        reason: "stt_watchdog",
      });
      _holdSent = true;
    }
  };

  return {
    activate() {
      if (_activated) return;
      _activated = true;
      deps.logger.info(
        { timeoutMs, checkIntervalMs },
        "STT watchdog activated",
      );
      // If the agent is already listening, start checking
      if (_agentListening && _sttEverActive) {
        startChecking();
      }
    },

    onSttActivity() {
      _lastActivityMs = Date.now();
      _holdSent = false; // Reset — STT is alive, cancel any early hold
      if (!_sttEverActive) {
        _sttEverActive = true;
        deps.logger.debug(
          {},
          "STT watchdog: first STT activity received — monitoring enabled",
        );
        // Now that STT has been active, start the check interval
        // if we're currently activated and listening
        if (_activated && _agentListening) {
          startChecking();
        }
      }
    },

    onAgentListening() {
      _agentListening = true;
      _listeningStartMs = Date.now();
      if (_activated && _sttEverActive) {
        startChecking();
      }
    },

    onAgentBusy() {
      _agentListening = false;
      // Don't stop the interval — just skip checks via the guard in check()
      // This avoids unnecessary start/stop churn during rapid state changes.
    },

    dispose() {
      _disposed = true;
      stopChecking();
    },

    get activated() {
      return _activated;
    },
    get sttEverActive() {
      return _sttEverActive;
    },
    get lastActivityMs() {
      return _lastActivityMs;
    },
  };
}
