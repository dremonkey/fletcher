/**
 * LiveKit participant tracking and management.
 */
import type { Room, RemoteParticipant, LocalParticipant } from "@livekit/rtc-node";
import { RoomEvent } from "@livekit/rtc-node";
import { getLivekitLogger } from "../runtime.js";
import type { Speaker } from "../types.js";

/**
 * Participant info for tracking.
 */
export interface ParticipantInfo {
  identity: string;
  name?: string;
  joinedAt: Date;
  isSpeaking: boolean;
}

/**
 * Participant event handlers.
 */
export interface ParticipantEventHandlers {
  onJoin?: (participant: ParticipantInfo) => void;
  onLeave?: (participant: ParticipantInfo) => void;
  onSpeakingChanged?: (participant: ParticipantInfo, speaking: boolean) => void;
}

/**
 * Participant tracker for a room.
 */
export class ParticipantTracker {
  private participants = new Map<string, ParticipantInfo>();
  private handlers: ParticipantEventHandlers;
  private room: Room;

  constructor(room: Room, handlers: ParticipantEventHandlers = {}) {
    this.room = room;
    this.handlers = handlers;
    this.setupEventHandlers();
  }

  /**
   * Set up room event handlers for participant tracking.
   */
  private setupEventHandlers(): void {
    const log = getLivekitLogger();

    this.room.on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
      const info = this.addParticipant(participant);
      log.debug(`Participant joined: ${info.identity} (${info.name})`);
      this.handlers.onJoin?.(info);
    });

    this.room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
      const info = this.participants.get(participant.identity);
      if (info) {
        log.debug(`Participant left: ${info.identity} (${info.name})`);
        this.handlers.onLeave?.(info);
        this.participants.delete(participant.identity);
      }
    });

    // Track existing participants
    for (const participant of this.room.remoteParticipants.values()) {
      this.addParticipant(participant);
    }
  }

  /**
   * Add a participant to tracking.
   */
  private addParticipant(participant: RemoteParticipant | LocalParticipant): ParticipantInfo {
    const info: ParticipantInfo = {
      identity: participant.identity,
      name: participant.name,
      joinedAt: new Date(),
      isSpeaking: false,
    };
    this.participants.set(participant.identity, info);
    return info;
  }

  /**
   * Get all current participants.
   */
  getParticipants(): ParticipantInfo[] {
    return Array.from(this.participants.values());
  }

  /**
   * Get a participant by identity.
   */
  getParticipant(identity: string): ParticipantInfo | undefined {
    return this.participants.get(identity);
  }

  /**
   * Get participant count.
   */
  getParticipantCount(): number {
    return this.participants.size;
  }

  /**
   * Convert participant info to speaker format for OpenClaw.
   */
  toSpeaker(identity: string): Speaker | undefined {
    const info = this.participants.get(identity);
    if (!info) return undefined;
    return {
      id: info.identity,
      name: info.name,
    };
  }

  /**
   * Clean up event handlers.
   */
  dispose(): void {
    this.participants.clear();
  }
}

/**
 * Create a speaker object from participant info.
 */
export function createSpeaker(identity: string, name?: string): Speaker {
  return {
    id: identity,
    name: name ?? identity,
  };
}
