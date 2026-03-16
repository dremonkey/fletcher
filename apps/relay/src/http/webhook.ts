import type { WebhookReceiver } from "livekit-server-sdk";
import type { BridgeManager } from "../bridge/bridge-manager";
import type { Logger } from "../utils/logger";
import { isHumanParticipant } from "../livekit/participant-filter";

/**
 * Creates an HTTP handler for LiveKit server webhooks.
 *
 * On `participant_joined` events from standard (non-relay, non-agent)
 * participants, automatically joins the relay to that room via bridgeManager.
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

      // Cancel any pending deferred teardown — participant reconnected
      bridgeManager.cancelPendingTeardown(roomName);

      if (bridgeManager.hasRoom(roomName)) {
        log.debug("Room already joined, skipping");
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

      // BUG-036: Remove room immediately instead of scheduling a deferred teardown.
      // This ensures that if the human rejoins, they get a fresh relay bridge
      // and ACP session, which helps recover from state issues (like BUG-027c).
      // Once Epic 25 (Session Restoration) is implemented, the relay will
      // be able to restore the previous session state automatically.
      try {
        await bridgeManager.removeRoom(roomName);
        log.info({ roomName, identity: participant?.identity }, "Removed room immediately after participant left");
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        log.error({ roomName, error: message }, "Failed to remove room after participant left");
      }
    }

    return Response.json({ received: true });
  };
}
