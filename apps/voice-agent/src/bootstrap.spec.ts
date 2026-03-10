import { describe, expect, it } from 'bun:test';
import { buildBootstrapMessage, BOOTSTRAP_SENTINEL } from './bootstrap';

describe('buildBootstrapMessage', () => {
  describe('normal rooms', () => {
    const ctx = { roomName: 'my-room', participantIdentity: 'user-1' };

    it('includes the TTS context preamble', () => {
      const msg = buildBootstrapMessage(ctx);
      expect(msg).toContain('voice conversation');
    });

    it('forbids markdown syntax in responses', () => {
      const msg = buildBootstrapMessage(ctx);
      expect(msg).toContain('no asterisks');
      expect(msg).toContain('no hashes');
      expect(msg).toContain('no hyphens as bullet points');
      expect(msg).toContain('no backticks');
    });

    it('instructs verbal signposting instead of bullet points', () => {
      const msg = buildBootstrapMessage(ctx);
      expect(msg).toContain('verbal signposting');
      expect(msg).toContain('First');
      expect(msg).toContain('Second');
      expect(msg).toContain('And finally');
    });

    it('includes punctuation-for-prosody rules', () => {
      const msg = buildBootstrapMessage(ctx);
      expect(msg).toContain('commas for brief pauses');
      expect(msg).toContain('ellipses');
      expect(msg).toContain('em-dashes');
    });

    it('includes phonetic override for Knittt', () => {
      const msg = buildBootstrapMessage(ctx);
      expect(msg).toContain('Knittt');
      expect(msg).toContain('knit');
    });

    it('includes phonetic override for Toch', () => {
      const msg = buildBootstrapMessage(ctx);
      expect(msg).toContain('Toch');
      expect(msg).toContain('toke');
    });

    it('instructs not to read URLs aloud', () => {
      const msg = buildBootstrapMessage(ctx);
      expect(msg).toContain('Never read out URLs');
    });

    it('includes number formatting guidance', () => {
      const msg = buildBootstrapMessage(ctx);
      expect(msg).toContain('Spell out numbers under 10');
    });

    it('ends with the bootstrap sentinel footer', () => {
      const msg = buildBootstrapMessage(ctx);
      expect(msg).toContain(BOOTSTRAP_SENTINEL);
    });
  });

  describe('e2e rooms', () => {
    const ctx = { roomName: 'e2e-smoke', participantIdentity: 'bot-1' };

    it('returns a brief e2e-specific message', () => {
      const msg = buildBootstrapMessage(ctx);
      expect(msg).toContain('automated end-to-end test');
      expect(msg).toContain('one sentence maximum');
    });

    it('ends with the bootstrap sentinel footer', () => {
      const msg = buildBootstrapMessage(ctx);
      expect(msg).toContain(BOOTSTRAP_SENTINEL);
    });

    it('does not contain voice TTS rules (e2e keeps messages short)', () => {
      const msg = buildBootstrapMessage(ctx);
      expect(msg).not.toContain('no asterisks');
    });
  });
});
