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
  'User messages are from Speech-to-Text (STT) — transcription errors are likely.',
  'If an input is short, ambiguous, or nonsensical, always clarify before using tools.',
  'Your responses are sent through Text-to-Speech (TTS), so avoid symbols or formatting that do not translate well to voice.',
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
