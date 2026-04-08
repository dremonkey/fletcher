import type { WebhookReceiver } from "livekit-server-sdk";
import type { BridgeManager } from "../bridge/bridge-manager";
import type { Logger } from "../utils/logger";
import { isHumanParticipant } from "../livekit/participant-filter";

/**
 * Creates an HTTP handler for LiveKit server webhooks.
 *
 * On `participant_joined` events from standard (non-relay, non-agent)
 * participants, automatically joins the relay to that room via bridgeManager.
 *
 * On `participant_left` events, schedules a deferred teardown after the
 * departure grace period. If the participant rejoins within the grace period
 * (e.g. network switch), the teardown is cancelled and the existing bridge
 * is validated for health before reuse.
 */
export function createWebhookHandler(
  webhookReceiver: WebhookReceiver,
  bridgeManager: BridgeManager,
  logger: Logger,
) {
  return async (req: Request): Promise<Response> => {
    const body = await req.text();
    const authHeader = req.headers.get("Authorization") ?? undefined;

    let event;
    try {
      event = await webhookReceiver.receive(body, authHeader);
    } catch {
      logger.warn({ event: "webhook_auth_failed" }, "Webhook signature validation failed");
      return Response.json({ error: "Invalid signature" }, { status: 401 });
    }

    const log = logger.child({ webhookEvent: event.event, room: event.room?.name });

    if (event.event === "participant_joined") {
      const participant = event.participant;

      // Skip non-human participants (relay instances, agents)
      if (participant && !isHumanParticipant(participant)) {
        log.debug({ identity: participant.identity, kind: participant.kind }, "Ignoring non-human participant");
        return Response.json({ received: true });
      }

      const roomName = event.room?.name;
      if (!roomName) {
        log.warn("participant_joined event missing room name");
        return Response.json({ received: true });
      }

      // Clear any bind-failed blacklist — participant is back
      bridgeManager.clearBindBlacklist(roomName);

      // Cancel any pending deferred teardown — participant reconnected
      const wasPendingTeardown = bridgeManager.cancelPendingTeardown(roomName);

      if (bridgeManager.hasRoom(roomName)) {
        if (wasPendingTeardown) {
          // Bridge survived the grace period — validate health before reuse (BUG-036 safety)
          try {
            await bridgeManager.validateOrReplaceBridge(roomName);
            log.info({ roomName }, "Validated bridge after reconnect");
          } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            log.error({ roomName, error: message }, "Failed to validate bridge after reconnect");
          }
        } else {
          log.debug("Room already joined, skipping");
        }
        return Response.json({ received: true });
      }

      try {
        await bridgeManager.addRoom(roomName);
        log.info({ roomName }, "Auto-joined room via webhook");
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        log.error({ roomName, error: message }, "Failed to auto-join room via webhook");
      }
    }

    if (event.event === "participant_left") {
      const participant = event.participant;

      // Skip non-human participants (relay instances, agents)
      if (participant && !isHumanParticipant(participant)) {
        log.debug({ identity: participant.identity, kind: participant.kind }, "Ignoring non-human participant leave");
        return Response.json({ received: true });
      }

      const roomName = event.room?.name;
      if (!roomName || !bridgeManager.hasRoom(roomName)) {
        return Response.json({ received: true });
      }

      // Schedule deferred teardown — relay stays in the room during the grace period.
      // If the participant rejoins (e.g. network switch), the teardown is cancelled
      // and the bridge is validated before reuse.
      bridgeManager.scheduleRemoveRoom(roomName);
      log.info({ roomName, identity: participant?.identity }, "Scheduled deferred teardown after participant left");
    }

    return Response.json({ received: true });
  };
}
