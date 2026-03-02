/**
 * Pondering phrases — fun status messages shown while the LLM is thinking.
 *
 * These rotate on the client's status bar during the wait between
 * end-of-utterance and first content token, replacing dead silence
 * with personality.
 */

const PONDERING_PHRASES = [
  // Classic
  'Thinking...',
  'Pondering...',
  'Contemplating...',
  'Mulling it over...',
  'Considering...',

  // Glitchy / digital
  'Defragmenting thoughts...',
  'Discombobulating...',
  'Reticulating splines...',
  'Consulting the oracle...',
  'Shuffling neurons...',
  'Compiling a response...',

  // Sci-fi
  'Dreaming of electric sheep...',
  'Traversing the astral plane...',
  'Scanning the multiverse...',
  'Quantum entangling...',

  // Fantasy
  'Summoning words...',
  'Slaying demons...',
  'Consulting the runes...',
  'Brewing a potion...',
  'Casting a spell...',
  'Reading the tea leaves...',

  // Whimsical
  'Herding cats...',
  'Untangling spaghetti...',
  'Chasing butterflies...',
  'Counting to infinity...',
  'Asking the magic 8-ball...',
] as const;

/**
 * Returns a shuffled copy of the pondering phrases.
 * Each call produces a fresh random order.
 */
export function getShuffledPhrases(): string[] {
  const phrases = [...PONDERING_PHRASES];
  // Fisher-Yates shuffle
  for (let i = phrases.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [phrases[i], phrases[j]] = [phrases[j], phrases[i]];
  }
  return phrases;
}
