# Technical Specification: Persistent Speaker Voice Fingerprinting (Voice Key)

## 1. Overview
This specification outlines the architecture for "Voice Key," a persistent speaker identification system for Fletcher. The system creates unique voice fingerprints (embeddings) from LiveKit audio streams, stores them in a local registry, and injects the identified speaker's identity into the LLM context. This enables the agent to recognize users across sessions ("Oh, hi Andre!") without relying on cloud-based identity providers, adhering to local-first sovereignty principles.

## 2. Goals
1.  **Identification**: Real-time or near real-time identification of speakers in a LiveKit room.
2.  **Persistence**: Long-term storage of voice embeddings associated with user identities.
3.  **Context Injection**: dynamic injection of speaker names into the LLM's system prompt or session context.
4.  **Sovereignty**: All processing (fingerprinting, storage, matching) occurs locally on the agent server or device, avoiding external APIs.

## 3. Architecture

The solution will be implemented primarily within the **LiveKit Agent** backend (Node.js/Python), leveraging the raw audio frames available via the LiveKit SDK.

### 3.1. Components

1.  **Voice Processor (The Ear)**
    *   **Input**: Raw PCM audio frames from LiveKit `RemoteAudioTrack`.
    *   **VAD (Voice Activity Detection)**: filters silence to ensure only speech is processed (using `silero-vad` or WebRTC VAD).
    *   **Diarization (Optional/Future)**: Segregating multiple speakers on one track (deferred for MVP; assuming 1 speaker per track for now).

2.  **Fingerprint Engine (The Brain)**
    *   **Model**: Use a pre-trained speaker verification model.
        *   *Recommendation*: **WavLM** or **ECAPA-TDNN** (via `speechbrain` or `onnxruntime` for Node.js). These models output a fixed-size vector (embedding) representing the voice characteristics.
        *   *Runtime*: ONNX Runtime (CPU/GPU) to keep it lightweight and fast in Node.js.

3.  **Voice Key Registry (The Memory)**
    *   **Storage**: A local vector store or simple JSON/SQLite database containing:
        *   `speaker_id` (UUID)
        *   `label` (e.g., "Andre")
        *   `embedding` (Float32Array)
        *   `last_seen` (Timestamp)
        *   `confidence_threshold` (Float)
    *   **Matching Strategy**: Cosine similarity between the live audio embedding and stored embeddings.

4.  **Context Injector (The Mouth)**
    *   **Integration**: Intercepts the LLM context construction pipeline in `openclaw-channel-livekit`.
    *   **Action**: When a speaker is identified with high confidence (> 0.75), update the session's "user identity" field or inject a system message: `[System: The speaker has been identified as Andre]`.

### 3.2. Data Flow

1.  **Audio In**: LiveKit agent receives audio stream.
2.  **Buffer**: Accumulate ~3-5 seconds of speech audio.
3.  **Process**:
    *   Check VAD. If active speech:
    *   Generate Embedding `E_new`.
4.  **Match**:
    *   Compare `E_new` against Registry.
    *   If `Similarity(E_new, E_stored) > Threshold`: Match found.
    *   Else: Label as "Unknown Speaker" (optionally auto-create new ID).
5.  **Echo**:
    *   Emit event `speaker_identified(label)`.
    *   Agent updates LLM context.

## 4. Technology Stack Selection

*   **Language**: TypeScript/Node.js (matching existing `openclaw-channel-livekit`).
*   **Inference**: `onnxruntime-node` (for running the model).
*   **Model**: `ECAPA-TDNN` (exported to ONNX). It is small, fast, and accurate for text-independent speaker verification.
*   **Vector Search**: Simple in-memory cosine similarity (for < 1000 voices) or `hnswlib-node` if scaling is needed. MVP: Linear scan is fine.

## 5. Implementation Plan

### Phase 1: The engine
*   Set up ONNX runtime in the Node.js agent.
*   Load the `ECAPA-TDNN` model.
*   Create a utility function `fingerprint(audioBuffer) -> vector`.

### Phase 2: The Registry
*   Create `VoiceRegistry` class.
*   Methods: `enroll(name, audio)`, `identify(audio)`, `save()`, `load()`.
*   Store data in `~/.openclaw/voice_keys.json`.

### Phase 3: Integration
*   Hook into the LiveKit audio stream in `openclaw-channel-livekit`.
*   Implement the "Accumulate -> Identify" loop (running every ~5 seconds of active speech).
*   Inject the name into the LLM conversation context.

## 6. Sovereignty & Privacy
*   **Local Only**: No audio is sent to 3rd party APIs for identification.
*   **Filesystem**: Embeddings are stored in the user's controlled workspace.
*   **Opt-in**: The system should strictly be "enrollment based" (user says "Learn my voice").

## 7. Future Considerations (Knittt)
This module should be written as a standalone library/package (`@fletcher/voice-key`) so it can be imported into Knittt later. Knittt will use local microphone input instead of LiveKit streams, but the processing pipeline (PCM -> Embedding -> Match) is identical.

**Knittt Integration (Active):** The Knittt Ingestion Pipeline (`~/code/knittt/docs/tech-specs/ingestion-pipeline.md` §3.1 Stage 1c) consumes this module for persistent speaker identification. Key differences in the Knittt context:
- **Runtime:** ONNX via the `ort` crate in Rust (vs. `onnxruntime-node` in Fletcher). Same ECAPA-TDNN model, different host language.
- **Enrollment:** Owner voiceprint is captured implicitly during the Birth Conversation (Knittt's onboarding), not via explicit "Learn my voice" opt-in.
- **Registry storage:** DuckDB (vs. JSON file). Schema is the same (`speaker_id`, `label`, `embedding`, `last_seen`).
- **Downstream use:** Speaker identity gates personality extraction (owner-only) and enables cross-session relationship edges in the Knowledge Graph.
