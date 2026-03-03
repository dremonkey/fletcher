/**
 * TTS provider factory — returns the configured TTS instance.
 *
 * Set TTS_PROVIDER env var to switch backends:
 *   - 'elevenlabs' (default) — ElevenLabs TTS
 *   - 'google' — Gemini 2.5 Flash Preview TTS (requires GOOGLE_API_KEY)
 *
 * Additional env vars:
 *   GOOGLE_TTS_VOICE — Gemini voice name (default: 'Kore')
 *   ELEVENLABS_VOICE_ID — ElevenLabs voice ID
 */

import * as elevenlabs from '@livekit/agents-plugin-elevenlabs';
import * as google from '@livekit/agents-plugin-google';
import type { tts } from '@livekit/agents';
import type { Logger } from 'pino';

export type TTSProvider = 'elevenlabs' | 'google';

export function createTTS(provider: TTSProvider, logger: Logger): tts.TTS {
  switch (provider) {
    case 'google':
      logger.info({ voice: process.env.GOOGLE_TTS_VOICE || 'Kore' }, 'Using Google Gemini TTS');
      return new google.beta.TTS({
        model: 'gemini-2.5-flash-preview-tts',
        voiceName: process.env.GOOGLE_TTS_VOICE || 'Kore',
      });

    case 'elevenlabs':
    default:
      logger.info('Using ElevenLabs TTS');
      return new elevenlabs.TTS({
        apiKey: process.env.ELEVENLABS_API_KEY,
        modelId: 'eleven_turbo_v2_5',
        voiceId: process.env.ELEVENLABS_VOICE_ID,
        syncAlignment: false,
      });
  }
}
