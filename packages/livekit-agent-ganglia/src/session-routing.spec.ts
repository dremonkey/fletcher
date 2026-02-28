import { describe, it, expect } from 'bun:test';
import {
  resolveSessionKey,
  resolveSessionKeySimple,
  type SessionKey,
  type SpeakerVerification,
} from './session-routing.js';

describe('resolveSessionKey', () => {
  describe('solo participant (count=1)', () => {
    it('routes verified owner to "main"', () => {
      const key = resolveSessionKey(1, 'andre', 'room-abc', 'owner');
      expect(key).toEqual({ type: 'owner', key: 'main' });
    });

    it('routes verified guest to isolated session', () => {
      const key = resolveSessionKey(1, 'bob', 'room-abc', 'guest');
      expect(key).toEqual({ type: 'guest', key: 'guest_bob' });
    });

    it('routes unknown speaker to guest session', () => {
      const key = resolveSessionKey(1, 'bob', 'room-abc', 'unknown');
      expect(key).toEqual({ type: 'guest', key: 'guest_bob' });
    });
  });

  describe('multi-user room (count>1)', () => {
    it('routes to room session regardless of verification', () => {
      const key = resolveSessionKey(2, 'andre', 'project-standup', 'owner');
      expect(key).toEqual({ type: 'room', key: 'room_project-standup' });
    });

    it('routes guests in multi-user to room session', () => {
      const key = resolveSessionKey(3, 'bob', 'project-standup', 'guest');
      expect(key).toEqual({ type: 'room', key: 'room_project-standup' });
    });

    it('routes unknown speakers in multi-user to room session', () => {
      const key = resolveSessionKey(2, 'carol', 'standup', 'unknown');
      expect(key).toEqual({ type: 'room', key: 'room_standup' });
    });
  });

  describe('edge cases', () => {
    it('treats zero participants as solo', () => {
      const key = resolveSessionKey(0, 'andre', 'room-x', 'owner');
      expect(key).toEqual({ type: 'owner', key: 'main' });
    });

    it('preserves identity characters in guest key', () => {
      const key = resolveSessionKey(1, 'user@example.com', 'room-x', 'guest');
      expect(key).toEqual({ type: 'guest', key: 'guest_user@example.com' });
    });

    it('preserves room name characters in room key', () => {
      const key = resolveSessionKey(2, 'bob', 'my-room_123', 'owner');
      expect(key).toEqual({ type: 'room', key: 'room_my-room_123' });
    });
  });
});

describe('resolveSessionKeySimple', () => {
  it('matches owner identity → owner routing', () => {
    const key = resolveSessionKeySimple('andre', 'andre');
    expect(key).toEqual({ type: 'owner', key: 'main' });
  });

  it('mismatched identity → guest routing', () => {
    const key = resolveSessionKeySimple('bob', 'andre');
    expect(key).toEqual({ type: 'guest', key: 'guest_bob' });
  });

  it('undefined owner → always guest', () => {
    const key = resolveSessionKeySimple('andre', undefined);
    expect(key).toEqual({ type: 'guest', key: 'guest_andre' });
  });

  it('empty owner string → guest', () => {
    const key = resolveSessionKeySimple('andre', '');
    expect(key).toEqual({ type: 'guest', key: 'guest_andre' });
  });

  it('multi-user room overrides owner match', () => {
    const key = resolveSessionKeySimple('andre', 'andre', 'standup', 2);
    expect(key).toEqual({ type: 'room', key: 'room_standup' });
  });

  it('defaults to solo participant if count not provided', () => {
    const key = resolveSessionKeySimple('andre', 'andre');
    expect(key.type).toBe('owner');
  });

  it('case-sensitive identity comparison', () => {
    const key = resolveSessionKeySimple('Andre', 'andre');
    expect(key.type).toBe('guest');
  });
});
