#!/usr/bin/env bun
/**
 * Backward-compat pointer — the voice agent now lives at apps/voice-agent/.
 * This re-exports so `bun run scripts/voice-agent.ts dev` still works.
 */
import '../apps/voice-agent/src/agent';
