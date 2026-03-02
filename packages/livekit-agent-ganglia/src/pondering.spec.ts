import { describe, expect, test } from 'bun:test';
import { getShuffledPhrases } from './pondering';

describe('pondering', () => {
  test('getShuffledPhrases returns all phrases', () => {
    const phrases = getShuffledPhrases();
    expect(phrases.length).toBeGreaterThan(20);
    expect(phrases.every((p) => typeof p === 'string')).toBe(true);
    expect(phrases.every((p) => p.length > 0)).toBe(true);
  });

  test('getShuffledPhrases returns a different order on successive calls', () => {
    // With 30+ phrases, the chance of identical order is astronomically low
    const a = getShuffledPhrases();
    const b = getShuffledPhrases();
    expect(a).not.toEqual(b);
  });

  test('getShuffledPhrases contains the same set of phrases each time', () => {
    const a = getShuffledPhrases().sort();
    const b = getShuffledPhrases().sort();
    expect(a).toEqual(b);
  });
});
