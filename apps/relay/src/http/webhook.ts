import type { WebhookReceiver } from "livekit-server-sdk";
import type { BridgeManager } from "../bridge/bridge-manager";
import type { Logger } from "../utils/logger";

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

      // Skip relay participants (our own joins)
      if (participant?.identity?.startsWith("relay-")) {
        log.debug({ identity: participant.identity }, "Ignoring relay participant");
        return Response.json({ received: true });
      }

      // Skip agent participants (voice agent, not a human)
      // ParticipantInfo_Kind.AGENT = 4
      if (participant?.kind === 4) {
        log.debug({ identity: participant.identity, kind: participant.kind }, "Ignoring agent participant");
        return Response.json({ received: true });
      }

      const roomName = event.room?.name;
      if (!roomName) {
        log.warn("participant_joined event missing room name");
        return Response.json({ received: true });
      }

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

      // Skip relay participants (our own disconnects)
      if (participant?.identity?.startsWith("relay-")) {
        log.debug({ identity: participant.identity }, "Ignoring relay participant leave");
        return Response.json({ received: true });
      }

      // Skip agent participants
      if (participant?.kind === 4) {
        log.debug({ identity: participant.identity, kind: participant.kind }, "Ignoring agent participant leave");
        return Response.json({ received: true });
      }

      const roomName = event.room?.name;
      if (!roomName || !bridgeManager.hasRoom(roomName)) {
        return Response.json({ received: true });
      }

      try {
        await bridgeManager.removeRoom(roomName);
        log.info({ roomName, identity: participant?.identity }, "Removed room after participant left");
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        log.error({ roomName, error: message }, "Failed to remove room after participant left");
      }
    }

    return Response.json({ received: true });
  };
}
