# Epic 27: End-to-End Encryption

## Status: 📋 Planned
## Priority: Low (becomes relevant when cloud LiveKit is on the roadmap)
## Depends On: Epic 7 (Sovereign Pairing — provides Ed25519 device keys)

## Problem

Today Fletcher runs entirely on self-hosted infrastructure: LiveKit SFU, voice agent, relay, and OpenClaw all run on the user's own machine. The trust boundary is the local network.

If Fletcher moves to **cloud-hosted LiveKit** (for reliability, NAT traversal, or multi-user scale), the SFU becomes a third party that can observe all traffic:

- **Data channel messages** (relay ACP traffic, transcripts, artifacts) — plaintext JSON
- **Audio tracks** (user voice, agent voice) — unencrypted at the SFU layer

This epic adds content-level encryption so a cloud SFU sees only opaque bytes.

## Threat Model

| Deployment | SFU sees data? | SFU sees audio? | E2EE needed? |
|------------|---------------|-----------------|-------------|
| **Self-hosted LiveKit** (current) | Yes, but it's your machine | Yes, but it's your machine | No |
| **Cloud LiveKit + self-hosted agent** | Yes — risk | Yes — risk | **Yes** |
| **Fully local (no LiveKit)** | N/A | N/A | No |

## Design

### What's feasible: Chat Mode E2EE (data channel)

Chat mode traffic flows over LiveKit data channels as JSON-RPC messages. Encrypting this is straightforward — same pattern as [MobVibe](https://github.com/Eric-Song-Nop/mobvibe), where the gateway is content-blind:

1. During sovereign pairing (Epic 7), mobile and Hub derive a shared symmetric key (e.g., X25519 DH from device Ed25519 keys, or a pre-shared key sealed during registration)
2. Before sending a data channel message, the sender NaCl-secretbox encrypts the JSON payload
3. LiveKit SFU routes the opaque bytes — it cannot read content
4. Receiver decrypts with the shared key

MobVibe's implementation uses a per-session DEK (Data Encryption Key) generated randomly and "sealed box" wrapped with the device's X25519 content public key. Their gateway never sees plaintext. We can adapt this directly — the relay decrypts with the Hub's key, the mobile decrypts with the device's key.

**Scope:** All `relay` and `voice-acp` data channel topics. Transcripts, ACP messages, artifacts, status events.

### What's architecturally moot: Voice Mode E2EE (audio tracks)

Voice E2EE is a non-problem for Fletcher's trust model:

- The voice agent **must hear the audio** to run STT — so the decryption endpoint is your own server
- If you trust your server (you do — it's self-hosted), encrypting audio between mobile and your server protects against... your own infrastructure
- LiveKit does support experimental [E2EE via SFrame/insertable streams](https://docs.livekit.io/home/client/e2ee/), but the agent server would need the key, making the SFU the only party excluded

**If you want full E2EE for voice, the entire pipeline must run locally:**
- Local STT (Epic 13: Edge Intelligence — on-device VAD/STT)
- Local TTS (Epic 19: Local Piper TTS — on-device synthesis)
- Local LLM (no cloud OpenClaw — fully local agent)
- Local LiveKit or direct WebRTC (no cloud SFU)

At that point there's no third party to encrypt against — everything is on-device or on your LAN. This is the "sovereign edge" deployment, and it's the only topology where voice conversations are truly private end-to-end.

### Summary

| Channel | Cloud E2EE | How | Effort |
|---------|-----------|-----|--------|
| **Data channel** (chat, ACP, artifacts) | Yes | NaCl-secretbox with paired device keys | Medium |
| **Audio** (voice mode) | No — run locally instead | Full local pipeline (STT + TTS + LLM + SFU) | Large (multiple epics) |

## Tasks

### Phase 1: Key Agreement

- [ ] **TASK-085: Derive shared content key during sovereign pairing**
  - Extend TASK-009/TASK-010 to perform X25519 key agreement during device registration
  - Hub and device each derive a shared symmetric key from their Ed25519 keys (converted to X25519)
  - Store content key alongside device credentials
  - _Depends on: Epic 7 Phase 2 (TASK-009)_

### Phase 2: Data Channel Encryption

- [ ] **TASK-086: Encrypt relay data channel messages**
  - Relay encrypts outbound JSON-RPC messages with NaCl-secretbox before `publishData()`
  - Relay decrypts inbound messages from mobile before forwarding to ACP
  - Nonce: monotonic counter (prevents replay) or random (simpler)
  - _Depends on: TASK-085_

- [ ] **TASK-087: Encrypt mobile data channel messages**
  - Flutter ACP client encrypts outbound messages before sending on data channel
  - Decrypts inbound relay messages before parsing JSON-RPC
  - Use `cryptography` package (already a dependency from Epic 7)
  - _Depends on: TASK-085_

### Phase 3: Voice-ACP Channel Encryption

- [ ] **TASK-088: Encrypt voice-acp data channel (voice agent ↔ relay)**
  - Same pattern as TASK-086/087 but for the `voice-acp` topic
  - Voice agent and relay share a key (both run on the same host, so key distribution is trivial)
  - Only relevant if voice agent and relay are on different hosts from the SFU
  - _Depends on: TASK-086_

### Future: Full Local Pipeline (no task files — tracked in other epics)

For true voice E2EE, these epics collectively eliminate cloud dependencies:
- Epic 13: Edge Intelligence (on-device STT)
- Epic 19: Local Piper TTS (on-device TTS)
- Local LLM / on-device agent (not yet planned)

## Prior Art

- **[MobVibe](https://github.com/Eric-Song-Nop/mobvibe)**: Content-blind relay with NaCl E2EE. Gateway routes encrypted blobs between CLI daemon and WebUI. Per-session DEK wrapped with device X25519 public key. Validates that the relay-as-opaque-router pattern works well. Key difference: MobVibe is text-only, so E2EE covers 100% of traffic. Fletcher's voice traffic requires a fundamentally different approach (local pipeline vs transport encryption).
