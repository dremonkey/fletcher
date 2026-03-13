/**
 * Shared participant classification for webhook and room discovery.
 */

/** LiveKit ParticipantInfo_Kind.AGENT */
export const PARTICIPANT_KIND_AGENT = 4;

/** Identity prefix used by this relay when joining rooms */
export const RELAY_IDENTITY_PREFIX = "relay-";

/**
 * Returns true if the participant is a real human user
 * (not a relay instance and not a LiveKit agent).
 */
export function isHumanParticipant(p: {
  identity?: string;
  kind?: number;
}): boolean {
  if (p.identity?.startsWith(RELAY_IDENTITY_PREFIX)) return false;
  if (p.kind === PARTICIPANT_KIND_AGENT) return false;
  return true;
}
