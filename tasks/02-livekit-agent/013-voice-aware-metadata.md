# TASK-013: Voice-Aware Metadata Tagging

## Status
- **Priority:** Medium
- **Owner:** Static
- **Created:** 2026-03-03
- **Context:** [OpenClaw Session 2026-03-03]

## Problem
When using Fletcher via voice/STT, transcription errors (STT hallucinations) or short, out-of-context handles (e.g., "inkleach") can cause the OpenClaw agent to engage in expensive, hallucinated research/work. This wastes tokens and causes user confusion. Currently, OpenClaw has no definitive way to distinguish between a precise text entry (webchat/WhatsApp) and a potentially noisy STT transcription.

## Proposed Solution
Use a **Explicit Prompt Wrapper** injected by Fletcher into every outgoing message to OpenClaw. This ensures the agent is immediately aware of the input source without requiring OpenClaw core modifications.

1. **Prompt Injection:** Modify the LiveKit agent to wrap the transcribed text in a standardized warning block:
   ```
   Text below is from Speech-to-Text. Transcription errors are likely. 
   If an input is short, ambiguous, or nonsensical, ALWAYS clarify before using tools.
   ---
   <transcribed text here>
   ```
2. **Standardization:** Use this exact block format to trigger the "High-Skepticism" mode in the OpenClaw agent.

## Implementation Details
- Target files: Likely in the LiveKit agent's request loop or the API client within `fletcher`.
- Metadata format: Use the standard OpenClaw `Inbound Context` schema.

## Verification
- Send a short, nonsensical word through Fletcher.
- Verify Glitch responds by asking for clarification rather than performing a web search or file scan.
