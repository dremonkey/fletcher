# Task: Migrate TTS from Cartesia to ElevenLabs

## Status
- **Priority:** High
- **Status:** Proposed
- **Owner:** Andre
- **Created:** 2026-02-28

## Problem
While Cartesia provides low latency, the vocal character is relatively limited and "clean." To fulfill the "Glitch" persona (unhinged, fun, expressive), we need the more nuanced and emotive models provided by ElevenLabs.

## Proposed Fix
Update the Fletcher TTS pipeline to support ElevenLabs as the primary provider.

1.  **Provider Integration:**
    - Implement the ElevenLabs SDK/API in the `@openclaw/channel-livekit` plugin.
    - Add `ELEVEN_LABS_API_KEY` to the environment configuration.
2.  **Voice Configuration:**
    - Support dynamic voice ID selection in `config.yaml`.
    - Default to one of the "Glitch" character voices (e.g., Squeegal, Fin, or The Alchemist).
3.  **Latency Tuning:**
    - Enable ElevenLabs "Turbo v2.5" model to minimize the latency trade-off.
    - Implement streaming audio chunks to ensure playback starts as soon as the first buffer is ready.
4.  **Fallback Logic:**
    - Keep Cartesia as a fallback provider in case of ElevenLabs API issues or rate limits.

## References
- Top 5 Voice Picks: Squeegal, Fin, Marcus, Piero, The Alchemist.
- Discussion in session `agent:main:main` on 2026-02-28.
