# Sovereign Pairing & Authentication Protocol

## Overview

This document outlines the "Sovereign Pairing" protocol used to authenticate edge devices (Fletcher clients) with the Fletcher Hub (OpenClaw). Instead of shared secrets or API keys, we use public-key cryptography (Ed25519).

The device holds a private key. The Hub holds the corresponding public key. Authentication is performed by signing a challenge.

## Goals

1.  **Zero Shared Secrets:** No passwords or API keys transmitted over the wire.
2.  **Device Identity:** Each device is identified by its public key (or a hash of it).
3.  **Replay Protection:** Challenges are time-bound or nonce-based.
4.  **Portability:** The logic should be self-contained to support the future standalone Knittt Hub.

## Protocol Flow

### 1. Pairing (Out of Band)

*   **Action:** User registers a new device.
*   **Data:** The device's **Public Key** (Ed25519) is shared with the Hub.
*   **Storage:** The Hub stores the Public Key and associates it with a `deviceId` and permissions.

### 2. Authentication (Token Request)

When the device wants to connect to LiveKit, it requests an access token from the Hub.

**Endpoint:** `POST /fletcher/auth/token`

**Request Payload:**

```json
{
  "deviceId": "device_123",
  "timestamp": 1708500000,
  "nonce": "random_string_123",
  "signature": "base64_encoded_signature"
}
```

*   **Signing:**
    *   The device constructs a payload string: `deviceId + ":" + timestamp + ":" + nonce`.
    *   The device signs this string using its **Private Key** (Ed25519).
    *   The resulting signature is sent in the `signature` field.

**Verification (Hub Side):**

1.  **Lookup:** Retrieve the Public Key for `deviceId`. If not found, reject (404/401).
2.  **Time Check:** Verify `timestamp` is within an acceptable window (e.g., +/- 5 minutes) to prevent replay attacks.
3.  **Signature Check:**
    *   Reconstruct the payload string: `deviceId + ":" + timestamp + ":" + nonce`.
    *   Verify the `signature` against this payload using the stored Public Key.
4.  **Success:**
    *   Generate a LiveKit Access Token (permissions based on device role).
    *   Return the token to the device.

**Response:**

```json
{
  "token": "livekit_access_token_jwt...",
  "url": "wss://your-livekit-instance.com"
}
```

## Implementation Plan

### Dependencies

*   `libsodium` or `noble-ed25519` for crypto operations.
*   Node.js `crypto` module (if Ed25519 is supported in the target environment).

### Data Model

For the prototype, we will use a simple in-memory or JSON-based store for public keys.

```typescript
interface DeviceIdentity {
  deviceId: string;
  publicKey: string; // Hex or Base64 encoded Ed25519 public key
  label?: string;
}
```

### API Route

We will register a route in the `@openclaw/channel-livekit` plugin using `api.registerHttpRoute()`.

```typescript
api.registerHttpRoute({
  method: 'POST',
  path: '/fletcher/token',
  handler: handleTokenRequest
});
```

## Future Considerations

*   **Challenge-Response:** Move to a 2-step handshake (Request Challenge -> Sign Challenge) for stronger replay protection if timestamps prove insufficient.
*   **Key Rotation:** Mechanism for updating keys.
*   **Permissions:** Granular scopes in the LiveKit token.
