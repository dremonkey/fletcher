/**
 * Bootstrap message builder — sends a synthetic user message at session start
 * via `session.generateReply({ userInput })` so the message flows through the
 * full voice pipeline to the backend.
 *
 * Every room gets a bootstrap message:
 *   - E2E test rooms (`e2e-*`): keep responses brief, no tools/memory
 *   - Normal rooms: formatting context so the LLM knows input is dictated
 *
 * ## OpenClaw voice mode detection (BUG-014 / BUG-033)
 *
 * OpenClaw's gateway has automatic voice mode detection. When it identifies a
 * session as "voice", it activates server-side audio generation and SUPPRESSES
 * `agent_message_chunk` updates (text streaming). This is intended for clients
 * that let OpenClaw handle TTS, but Fletcher runs its own TTS pipeline — so
 * suppressed chunks means the voice agent gets zero text and the user hears
 * nothing.
 *
 * The gateway's detection triggers on keywords in the prompt content. Known
 * trigger words (non-exhaustive):
 *
 *   - "voice" (e.g. "voice conversation", "voice message")
 *   - "TTS" / "Text-to-Speech"
 *   - "STT" / "Speech-to-Text"
 *
 * **DO NOT use any of these words in the bootstrap message.** Use indirect
 * phrasing instead:
 *
 *   | Avoid                  | Use instead                        |
 *   |------------------------|------------------------------------|
 *   | "voice conversation"   | "dictated, not typed"              |
 *   | "Speech-to-Text"       | "transcription errors"             |
 *   | "TTS engine"           | "read aloud"                       |
 *   | "voice messages"       | "dictated messages" or just drop   |
 *
 * This was first hit in BUG-014 (completions API) and recurred in BUG-033
 * (ACP protocol) — same root cause, different transport.
 *
 * Future: mission briefing / silent handshake (EPIC 14).
 */

export interface BootstrapContext {
  roomName: string;
  participantIdentity: string;
}

/**
 * Voice tag prepended to all user messages sent through the voice agent.
 * Configurable via FLETCHER_VOICE_TAG env var. Set to empty string to disable.
 */
export const VOICE_TAG = process.env.FLETCHER_VOICE_TAG ?? "[VOICE]";

const BOOTSTRAP_FOOTER = "\n\nDo not reply to this message.";

const E2E_BOOTSTRAP_BODY = [
  "This is an automated end-to-end test session.",
  "Keep all responses extremely brief — one sentence maximum.",
  "Do not use tools, memory retrieval, or any external resources.",
  "Simply acknowledge what you hear.",
].join(" ");

function buildVoiceBootstrapBody(): string {
  // IMPORTANT: Avoid keywords like "voice", "TTS", "Speech-to-Text", "STT"
  // in the bootstrap message. OpenClaw's gateway detects these and activates
  // its own server-side audio generation mode, which suppresses text chunks
  // (agent_message_chunk updates) — breaking Fletcher's pipeline. (BUG-014)
  return [
    // Brevity
    `User messages tagged with \`${VOICE_TAG}\` are dictated, not typed.`,
    "Keep responses brief — two or three sentences maximum.",

    // Transcription awareness (avoid "STT" / "Speech-to-Text")
    `Messages tagged with \`${VOICE_TAG}\` may contain transcription errors.`,
    "If an input is short, ambiguous, or nonsensical, always clarify before using tools or starting a new task.",

    // Plain text output rules — no markdown (avoid "TTS" / "Text-to-Speech")
    "Your responses will be read aloud.",
    "Never use any markdown syntax.",
    "That means no asterisks, no hashes, no hyphens as bullet points, no square brackets, no backticks, no underscores for emphasis, and no numbered lists with periods.",
    "Markdown symbols are read aloud literally and will sound broken.",

    // Verbal structure instead of lists
    'When listing multiple items, use verbal signposting — say "First...", "Second...", "And finally..." — instead of bullet points or numbered lists.',

    // Punctuation for prosody
    "Use punctuation to control pacing: commas for brief pauses, ellipses (...) for longer pauses or trailing thoughts, and em-dashes (—) for abrupt emphasis breaks.",

    // No URLs read aloud
    "Never read out URLs or file paths — summarize them verbally instead.",

    // Number formatting
    "Spell out numbers under 10 in words (one, two, three). Use digits for larger numbers.",
  ].join(" ");
}

/**
 * Returns a bootstrap user message for the given room context.
 */
export function buildBootstrapMessage(ctx: BootstrapContext): string {
  if (ctx.roomName.startsWith("e2e-")) {
    return E2E_BOOTSTRAP_BODY + BOOTSTRAP_FOOTER;
  }
  return buildVoiceBootstrapBody() + BOOTSTRAP_FOOTER;
}

/** Sentinel suffix used to detect bootstrap messages in the LLM pipeline. */
export const BOOTSTRAP_SENTINEL = "Do not reply to this message.";
