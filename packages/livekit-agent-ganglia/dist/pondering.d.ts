/**
 * Pondering phrases — fun status messages shown while the LLM is thinking.
 *
 * These rotate on the client's status bar during the wait between
 * end-of-utterance and first content token, replacing dead silence
 * with personality.
 */
/**
 * Returns a shuffled copy of the pondering phrases.
 * Each call produces a fresh random order.
 */
export declare function getShuffledPhrases(): string[];
