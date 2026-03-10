/**
 * Bootstrap message builder — sends a synthetic user message at session start
 * via `session.generateReply({ userInput })` so the message flows through the
 * full voice pipeline to the backend.
 *
 * Every room gets a bootstrap message:
 *   - E2E test rooms (`e2e-*`): keep responses brief, no tools/memory
 *   - Normal rooms: STT/TTS context so the agent knows input is transcribed
 *
 * Future: mission briefing / silent handshake (EPIC 14).
 */

export interface BootstrapContext {
  roomName: string;
  participantIdentity: string;
}

const BOOTSTRAP_FOOTER = '\n\nDo not reply to this message.';

const E2E_BOOTSTRAP_BODY = [
  'This is an automated end-to-end test session.',
  'Keep all responses extremely brief — one sentence maximum.',
  'Do not use tools, memory retrieval, or any external resources.',
  'Simply acknowledge what you hear.',
].join(' ');

const VOICE_BOOTSTRAP_BODY = [
  'This is a voice conversation.',

  // STT awareness
  'User messages are from Speech-to-Text (STT) — transcription errors are likely.',
  'If an input is short, ambiguous, or nonsensical, always clarify before using tools.',

  // TTS output rules — no markdown
  'Your responses are delivered through a Text-to-Speech (TTS) engine.',
  'Never use any markdown syntax in spoken responses.',
  'That means no asterisks, no hashes, no hyphens as bullet points, no square brackets, no backticks, no underscores for emphasis, and no numbered lists with periods.',
  'Markdown symbols are read aloud literally by the TTS engine and will sound broken.',

  // Verbal structure instead of lists
  'When listing multiple items, use verbal signposting — say "First...", "Second...", "And finally..." — instead of bullet points or numbered lists.',

  // Punctuation for prosody
  'Use punctuation to control pacing: commas for brief pauses, ellipses (...) for longer pauses or trailing thoughts, and em-dashes (—) for abrupt emphasis breaks.',

  // Phonetic overrides for project-specific terms
  'Pronounce "Knittt" as "knit" — the extra letters are silent.',
  'Pronounce "Toch" as "toke".',

  // No URLs read aloud
  'Never read out URLs or file paths — summarize them verbally instead.',

  // Number formatting
  'Spell out numbers under 10 in words (one, two, three). Use digits for larger numbers.',
].join(' ');

/**
 * Returns a bootstrap user message for the given room context.
 */
export function buildBootstrapMessage(ctx: BootstrapContext): string {
  if (ctx.roomName.startsWith('e2e-')) {
    return E2E_BOOTSTRAP_BODY + BOOTSTRAP_FOOTER;
  }
  return VOICE_BOOTSTRAP_BODY + BOOTSTRAP_FOOTER;
}

/** Sentinel suffix used to detect bootstrap messages in the LLM pipeline. */
export const BOOTSTRAP_SENTINEL = 'Do not reply to this message.';
