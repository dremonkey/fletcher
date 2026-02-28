/**
 * Session Key Routing
 *
 * Resolves which backend session a voice conversation should route to,
 * based on who is speaking (owner vs guest) and how many participants
 * are in the room.
 *
 * See: docs/specs/08-session-continuity/spec.md
 */

/**
 * The resolved session key that determines backend routing.
 *
 * - owner: routes to the owner's primary session ("main")
 * - guest: routes to an isolated guest session
 * - room: routes to a shared room session (multi-user)
 */
export interface SessionKey {
  type: 'owner' | 'guest' | 'room';
  key: string;
}

/**
 * Speaker verification status.
 *
 * - "owner": speaker is verified as the owner (via voice fingerprint or identity match)
 * - "guest": speaker is verified as NOT the owner
 * - "unknown": verification has not completed yet
 */
export type SpeakerVerification = 'owner' | 'guest' | 'unknown';

/**
 * Configuration for session routing.
 */
export interface SessionRoutingConfig {
  /** The participant identity that maps to the owner's primary session */
  ownerIdentity?: string;
}

/**
 * Resolves the session key for a conversation based on room state and speaker verification.
 *
 * Routing rules:
 * - Solo + owner verified  → { type: "owner", key: "main" }
 * - Solo + not verified    → { type: "guest", key: "guest:{identity}" }
 * - Multi-user             → { type: "room", key: "room:{roomName}" }
 *
 * @param participantCount - Number of remote participants in the room (excluding the agent)
 * @param participantIdentity - The identity of the participant being routed
 * @param roomName - The LiveKit room name (used for multi-user routing)
 * @param speakerVerified - Speaker verification status
 */
export function resolveSessionKey(
  participantCount: number,
  participantIdentity: string,
  roomName: string,
  speakerVerified: SpeakerVerification,
): SessionKey {
  if (participantCount <= 1) {
    if (speakerVerified === 'owner') {
      return { type: 'owner', key: 'main' };
    }
    return { type: 'guest', key: `guest_${participantIdentity}` };
  }

  // Multi-user: shared room session
  return { type: 'room', key: `room_${roomName}` };
}

/**
 * Simplified session key resolution for the common single-participant case.
 *
 * Uses FLETCHER_OWNER_IDENTITY matching as the verification mechanism
 * (no voice fingerprinting). This is the fallback mode for early development.
 *
 * @param participantIdentity - The identity of the participant
 * @param ownerIdentity - The configured owner identity (from env or config)
 * @param roomName - The LiveKit room name (used for multi-user fallback)
 * @param participantCount - Number of remote participants (default: 1 for solo)
 */
export function resolveSessionKeySimple(
  participantIdentity: string,
  ownerIdentity: string | undefined,
  roomName: string = '',
  participantCount: number = 1,
): SessionKey {
  const verified: SpeakerVerification =
    ownerIdentity && participantIdentity === ownerIdentity ? 'owner' : 'guest';

  return resolveSessionKey(participantCount, participantIdentity, roomName, verified);
}
