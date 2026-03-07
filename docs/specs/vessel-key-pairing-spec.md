# Vessel Key Pairing Specification

**Epic:** 07-sovereign-pairing  
**Related Tasks:** 004 (Camera-based Pairing), 006 (Context Injection)  
**Status:** Draft  
**Author:** Static (pm-agent)  
**Date:** 2026-03-07

---

## Overview

The **Vessel Key** is a self-contained configuration payload that enables secure, proximity-based pairing between a fresh Fletcher mobile app ("Blank Slate") and a self-hosted Heirloom Hub (OpenClaw instance). This spec defines the payload structure, handshake protocol, and secure storage practices required to implement Tasks 004 and 006 in Epic 7.

## Design Goals

1. **Zero Manual Entry:** No typing of URLs, tokens, or credentials
2. **Physical Proximity:** Pairing requires physical access (QR scan or OCR)
3. **Self-Contained:** Payload includes everything needed for immediate connection
4. **Secure Bootstrap:** Establishes encrypted channel for subsequent auth exchanges
5. **Sovereign:** All credentials stay local to user's devices

---

## 1. Payload Structure

### 1.1 JSON Schema

The Vessel Key is a JSON object encoded as a QR code or text string displayed by the Hub CLI.

```json
{
  "version": "1.0",
  "hubIdentity": {
    "name": "Toch's Heirloom Hub",
    "deviceId": "hub_a1b2c3d4e5f6"
  },
  "network": {
    "gatewayUrl": "https://heirloom.local:8443",
    "tailscaleIp": "100.64.1.42",
    "tailscaleHostname": "heirloom-hub"
  },
  "auth": {
    "pairingToken": "pair_7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a",
    "tokenExpiry": 1709850600,
    "hubPublicKey": "ed25519:A1B2C3D4E5F6..."
  },
  "services": {
    "livekit": {
      "url": "wss://heirloom.local:7880",
      "region": "local"
    }
  },
  "metadata": {
    "createdAt": 1709850000,
    "createdBy": "andre@heirloom",
    "vesselName": "Toch"
  }
}
```

### 1.2 Field Specifications

#### `version` (string, required)
- Semantic version of the Vessel Key format
- Allows future protocol evolution
- Current: `"1.0"`

#### `hubIdentity` (object, required)
- **`name`** (string): Human-readable Hub name (shown in UI during pairing)
- **`deviceId`** (string): Unique Hub identifier (format: `hub_<16-hex-chars>`)

#### `network` (object, required)
- **`gatewayUrl`** (string): HTTPS endpoint for Hub API (mDNS `.local` or public domain)
- **`tailscaleIp`** (string): Tailscale IPv4 address of Hub (format: `100.x.x.x`)
- **`tailscaleHostname`** (string): Tailscale MagicDNS hostname

**Why both URL and Tailscale?** Enables dual-mode connectivity:
- Local network: Use `gatewayUrl` with mDNS
- Remote/mobile: Use Tailscale IP after app joins same tailnet

#### `auth` (object, required)
- **`pairingToken`** (string): One-time-use token for initial registration (format: `pair_<32-hex-chars>`)
  - **Expiry:** 15 minutes from creation (specified in `tokenExpiry`)
  - **Single-Use:** Invalidated after successful device registration
  - **Purpose:** Used only to register the device's Ed25519 public key with the Hub
- **`tokenExpiry`** (number): Unix timestamp when pairing token expires
- **`hubPublicKey`** (string): Hub's Ed25519 public key for verifying signed responses (format: `ed25519:<base64>`)

#### `services` (object, required)
- **`livekit`** (object):
  - **`url`** (string): LiveKit server WebSocket URL
  - **`region`** (string): Region identifier (typically `"local"` for self-hosted)

#### `metadata` (object, optional)
- **`createdAt`** (number): Unix timestamp of Vessel Key generation
- **`createdBy`** (string): Email/username of Hub admin who generated key
- **`vesselName`** (string): Name of the physical vessel/heirloom (e.g., "Toch")

### 1.3 Encoding & Display

**QR Code:**
- Encode JSON as compact UTF-8 string (no whitespace)
- Use QR error correction level M (15% recovery)
- Minimum size: 300×300px for reliable mobile scanning
- Display with white border (4 modules width)

**Terminal Display:**
```bash
$ openclaw vessel-key generate --name "Toch's Hub"

┌─────────────────────────────────────────┐
│ VESSEL KEY: Toch's Hub                  │
├─────────────────────────────────────────┤
│ [QR CODE HERE - 300x300]                │
├─────────────────────────────────────────┤
│ Expires: 2026-03-07 14:32 PST (14m 52s) │
│                                          │
│ Manual Entry:                            │
│ {"version":"1.0","hubIdentity":...      │
└─────────────────────────────────────────┘

Scan with Fletcher app or paste JSON manually.
```

---

## 2. Handshake Logic

### 2.1 Blank Slate State

When Fletcher is launched for the first time (or after factory reset), it enters the **Blank Slate** state.

**UI Characteristics:**
- Full-screen "Bootloader" view
- Centered amber orb (dim, static)
- Text: "Pair with your Heirloom Hub"
- Button: "Scan Vessel Key" → Opens camera
- Link: "Manual Entry" → Text input for JSON paste

**Storage Check:**
```dart
// lib/services/pairing_service.dart
Future<bool> isPaired() async {
  final storage = FlutterSecureStorage();
  final deviceId = await storage.read(key: 'device_id');
  final hubUrl = await storage.read(key: 'hub_gateway_url');
  return deviceId != null && hubUrl != null;
}
```

### 2.2 Pairing Flow (Task 004)

#### Step 1: Scan QR Code
```dart
// User taps "Scan Vessel Key"
// Open camera with QR detection overlay
import 'package:mobile_scanner/mobile_scanner.dart';

final controller = MobileScannerController();
controller.start();

// On QR detected:
void onDetect(BarcodeCapture capture) {
  final String? rawValue = capture.barcodes.first.rawValue;
  if (rawValue != null) {
    _parseVesselKey(rawValue);
  }
}
```

#### Step 2: Parse & Validate Payload
```dart
Future<VesselKey> _parseVesselKey(String rawData) async {
  try {
    final json = jsonDecode(rawData);
    
    // Schema validation
    if (json['version'] != '1.0') {
      throw PairingException('Unsupported Vessel Key version');
    }
    
    // Expiry check
    final expiry = json['auth']['tokenExpiry'] as int;
    if (DateTime.now().millisecondsSinceEpoch / 1000 > expiry) {
      throw PairingException('Pairing token expired');
    }
    
    return VesselKey.fromJson(json);
  } catch (e) {
    throw PairingException('Invalid Vessel Key: $e');
  }
}
```

#### Step 3: Generate Device Keypair
```dart
import 'package:cryptography/cryptography.dart';

final algorithm = Ed25519();
final keyPair = await algorithm.newKeyPair();

// Extract public key bytes
final publicKey = await keyPair.extractPublicKey();
final publicKeyBytes = publicKey.bytes;
final publicKeyBase64 = base64Encode(publicKeyBytes);
```

#### Step 4: Register Device with Hub
```dart
// POST to Hub's device registration endpoint
final response = await http.post(
  Uri.parse('${vesselKey.network.gatewayUrl}/fletcher/devices/register'),
  headers: {
    'Authorization': 'Bearer ${vesselKey.auth.pairingToken}',
    'Content-Type': 'application/json',
  },
  body: jsonEncode({
    'publicKey': publicKeyBase64,
    'deviceModel': '${Device.manufacturer} ${Device.model}',
    'os': Platform.operatingSystem,
    'appVersion': packageInfo.version,
  }),
);

if (response.statusCode != 201) {
  throw PairingException('Registration failed: ${response.body}');
}

final registrationData = jsonDecode(response.body);
final deviceId = registrationData['deviceId']; // e.g., "device_f1e2d3c4b5a6"
```

**Hub-Side Validation:**
```typescript
// packages/openclaw-channel-livekit/src/routes/devices.ts
api.registerHttpRoute({
  method: 'POST',
  path: '/fletcher/devices/register',
  handler: async (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    // Verify pairing token (single-use, not expired)
    const pairingSession = await validatePairingToken(token);
    if (!pairingSession) {
      return res.status(401).json({ error: 'Invalid pairing token' });
    }
    
    const { publicKey, deviceModel, os } = req.body;
    
    // Store device identity
    const deviceId = `device_${randomBytes(8).toString('hex')}`;
    await deviceStore.create({
      deviceId,
      publicKey,
      hubId: pairingSession.hubId,
      metadata: { deviceModel, os },
      createdAt: Date.now(),
    });
    
    // Invalidate pairing token
    await pairingTokenStore.revoke(token);
    
    return res.status(201).json({ deviceId });
  }
});
```

#### Step 5: Persist Credentials (see Section 3)
```dart
final storage = FlutterSecureStorage();

// Store device identity
await storage.write(key: 'device_id', value: deviceId);

// Store private key (securely!)
await storage.write(
  key: 'device_private_key',
  value: base64Encode(await keyPair.extractPrivateKeyBytes()),
);

// Store Hub connection details
await storage.write(key: 'hub_gateway_url', value: vesselKey.network.gatewayUrl);
await storage.write(key: 'hub_tailscale_ip', value: vesselKey.network.tailscaleIp);
await storage.write(key: 'hub_public_key', value: vesselKey.auth.hubPublicKey);
await storage.write(key: 'livekit_url', value: vesselKey.services.livekit.url);

// Store metadata for UI
await storage.write(key: 'hub_name', value: vesselKey.hubIdentity.name);
await storage.write(key: 'vessel_name', value: vesselKey.metadata?.vesselName ?? '');
```

#### Step 6: Transition to Paired State
```dart
// Update UI to show success
setState(() {
  _pairingState = PairingState.success;
});

// Navigate to main conversation screen after 1.5s
Future.delayed(Duration(milliseconds: 1500), () {
  Navigator.of(context).pushReplacement(
    MaterialPageRoute(builder: (_) => ConversationScreen()),
  );
});
```

### 2.3 Context Injection (Task 006)

Once paired, Fletcher can request Hub-wide configuration on-demand.

**Endpoint:** `GET /fletcher/config`

**Authentication:** Uses Ed25519 challenge-response (see [Sovereign Pairing spec](./07-sovereign-pairing.md))

**Response:**
```json
{
  "user": {
    "ownerName": "Andre",
    "timezone": "America/Los_Angeles",
    "preferredVoice": "toch_fingerprint_v1"
  },
  "features": {
    "voiceFingerprintingEnabled": true,
    "wakeWordEnabled": false,
    "backgroundListeningEnabled": true
  },
  "models": {
    "stt": "deepgram-nova-2",
    "tts": "elevenlabs-turbo-v2",
    "llm": "claude-sonnet-4"
  }
}
```

**Client-Side:**
```dart
// lib/services/hub_config_service.dart
class HubConfigService {
  Future<HubConfig> fetchConfig() async {
    final token = await _authenticateWithHub(); // Ed25519 challenge-response
    
    final response = await http.get(
      Uri.parse('${_hubUrl}/fletcher/config'),
      headers: {'Authorization': 'Bearer $token'},
    );
    
    return HubConfig.fromJson(jsonDecode(response.body));
  }
}
```

---

## 3. Secure Storage Practices

### 3.1 Flutter Secure Storage

**Recommended Package:** [`flutter_secure_storage`](https://pub.dev/packages/flutter_secure_storage)

```yaml
# pubspec.yaml
dependencies:
  flutter_secure_storage: ^9.0.0
```

**Usage:**
```dart
const storage = FlutterSecureStorage(
  aOptions: AndroidOptions(
    encryptedSharedPreferences: true,
  ),
  iOptions: IOSOptions(
    accessibility: KeychainAccessibility.first_unlock,
  ),
);
```

### 3.2 iOS Keychain (via flutter_secure_storage)

**Backend:** Uses iOS Keychain Services API (`kSecClass`, `kSecAttrAccessible`)

**Default Accessibility:** `kSecAttrAccessibleAfterFirstUnlock`
- Decrypts after first device unlock post-reboot
- Accessible while device is locked (background tasks)
- Protected by device passcode + Secure Enclave

**For Maximum Security:**
```dart
iOptions: IOSOptions(
  accessibility: KeychainAccessibility.when_unlocked_this_device_only,
  synchronizable: false, // Never sync to iCloud
)
```

**Key Protection:**
- Private keys stored in Keychain are encrypted with device UID + user passcode
- Secure Enclave (on iPhone 5s+) provides hardware-backed key storage
- Biometric authentication (Face ID/Touch ID) can gate access via `LocalAuthentication` package

**Example with Biometric Guard:**
```dart
import 'package:local_auth/local_auth.dart';

Future<String?> getPrivateKey() async {
  final auth = LocalAuthentication();
  
  if (await auth.canCheckBiometrics) {
    final authenticated = await auth.authenticate(
      localizedReason: 'Authenticate to access device key',
      options: const AuthenticationOptions(biometricOnly: true),
    );
    
    if (!authenticated) return null;
  }
  
  return await storage.read(key: 'device_private_key');
}
```

### 3.3 Android Keystore (via flutter_secure_storage)

**Backend:** Uses Android Keystore System (`KeyStore.getInstance("AndroidKeyStore")`)

**Default Behavior:**
- Generates AES key in Keystore
- Encrypts stored data with AES-GCM
- Keys are hardware-backed on devices with Trusted Execution Environment (TEE) or StrongBox

**Key Protection Levels:**
1. **Software-backed** (all devices): Keys encrypted in OS-protected storage
2. **TEE-backed** (most devices since 2015): Keys stored in isolated secure processor
3. **StrongBox** (Pixel 3+, Samsung Galaxy S9+): Keys stored in dedicated HSM chip

**Require Hardware Backing:**
```dart
aOptions: AndroidOptions(
  encryptedSharedPreferences: true,
  sharedPreferencesName: 'FletcherSecurePrefs',
  resetOnError: true, // Clear storage if decryption fails
  // Note: Hardware-backed enforcement requires platform channels
)
```

**Biometric Authentication:**
```dart
// Uses BiometricPrompt API (Android 9+)
final authenticated = await auth.authenticate(
  localizedReason: 'Authenticate to pair device',
  options: const AuthenticationOptions(
    biometricOnly: true,
    stickyAuth: true,
  ),
);
```

### 3.4 Security Best Practices

#### Never Store in Shared Preferences
```dart
// ❌ WRONG: Plaintext, world-readable (rooted devices)
final prefs = await SharedPreferences.getInstance();
prefs.setString('private_key', keyData); // DON'T DO THIS
```

```dart
// ✅ CORRECT: Encrypted, hardware-backed
const storage = FlutterSecureStorage();
await storage.write(key: 'device_private_key', value: keyData);
```

#### Key Rotation Strategy
```dart
// Store key version to enable future rotation
await storage.write(key: 'device_key_version', value: '1');

// On key rotation:
// 1. Generate new keypair
// 2. Register new public key with Hub (authenticated with old key)
// 3. Store new private key with incremented version
// 4. Delete old private key
```

#### Secure Deletion
```dart
// Overwrite before delete (defense-in-depth)
await storage.write(key: 'device_private_key', value: 'X' * 100);
await storage.delete(key: 'device_private_key');
```

#### Root/Jailbreak Detection
```dart
// Optional: Warn user if device is compromised
import 'package:flutter_jailbreak_detection/flutter_jailbreak_detection.dart';

final isJailbroken = await FlutterJailbreakDetection.jailbroken;
if (isJailbroken) {
  // Show warning, disable sensitive features, or refuse to pair
}
```

---

## 4. Error Handling

### 4.1 Pairing Errors

| Error | Cause | User Action |
|-------|-------|-------------|
| `VESSEL_KEY_EXPIRED` | QR code >15 minutes old | Generate new Vessel Key on Hub |
| `VESSEL_KEY_MALFORMED` | Invalid JSON or missing fields | Check Hub CLI output |
| `NETWORK_UNREACHABLE` | Hub not accessible | Verify devices on same network/tailnet |
| `REGISTRATION_FAILED` | Hub rejected device | Check Hub logs, try regenerating key |
| `BIOMETRIC_FAILED` | User cancelled auth | Retry or use passcode fallback |

### 4.2 Connection Errors

```dart
// Fallback from mDNS to Tailscale
Future<String> _resolveHubUrl() async {
  final gatewayUrl = await storage.read(key: 'hub_gateway_url');
  
  try {
    // Try mDNS first (faster on local network)
    await http.head(Uri.parse(gatewayUrl)).timeout(Duration(seconds: 2));
    return gatewayUrl;
  } catch (_) {
    // Fall back to Tailscale IP
    final tailscaleIp = await storage.read(key: 'hub_tailscale_ip');
    return 'https://$tailscaleIp:8443';
  }
}
```

---

## 5. Implementation Checklist

### Hub (OpenClaw) - **Claude Code/ACP**
- [ ] Implement `POST /fletcher/vessel-key/generate` CLI command
- [ ] QR code generation library (e.g., `qrcode-terminal` for Node.js)
- [ ] Pairing token generation & expiry tracking
- [ ] `POST /fletcher/devices/register` endpoint
- [ ] Device public key storage (SQLite or JSON file)
- [ ] Pairing token revocation after successful registration

### Mobile (Fletcher) - **Claude Code/ACP**
- [ ] Add `flutter_secure_storage: ^9.0.0` to `pubspec.yaml`
- [ ] Add `mobile_scanner: ^5.0.0` for QR scanning
- [ ] Add `cryptography: ^2.7.0` for Ed25519 keypair generation
- [ ] Add `local_auth: ^2.3.0` for biometric authentication
- [ ] Create `lib/models/vessel_key.dart` data model
- [ ] Create `lib/services/pairing_service.dart`
- [ ] Create `lib/screens/pairing_screen.dart` (Blank Slate UI)
- [ ] Update `lib/main.dart` to check pairing status on launch
- [ ] Implement device registration flow
- [ ] Implement secure credential storage
- [ ] Add error handling & user feedback

### Testing - **Manual QA**
- [ ] Generate Vessel Key on Hub, verify QR displays
- [ ] Scan QR with fresh Fletcher install
- [ ] Verify device registration in Hub logs
- [ ] Confirm credentials persisted after app restart
- [ ] Test pairing expiry (wait >15 min)
- [ ] Test network fallback (mDNS → Tailscale)
- [ ] Test biometric authentication (if enabled)

---

## 6. Future Enhancements

### 6.1 Multi-Device Support
- Allow single user to pair multiple devices (phone, tablet, smartwatch)
- Hub maintains list of trusted device public keys
- Device naming/labeling in Hub UI

### 6.2 NFC Tap-to-Pair
- Embed Vessel Key in NFC tag on physical vessel
- Flutter NFC reader (`flutter_nfc_kit`) for Android/iOS
- Fallback to QR for devices without NFC

### 6.3 Bluetooth Proximity Verification
- Additional security layer: require Bluetooth proximity during pairing
- Prevents remote attacks if QR is photographed/leaked

### 6.4 Key Rotation
- Periodic keypair rotation (e.g., every 90 days)
- Hub-initiated rotation via push notification

---

## 7. References

- **Epic 7:** [tasks/07-sovereign-pairing/EPIC.md](../../tasks/07-sovereign-pairing/EPIC.md)
- **Sovereign Pairing Protocol:** [docs/specs/07-sovereign-pairing.md](./07-sovereign-pairing.md)
- **Task 004:** Camera-based Pairing (QR Scanner / OCR integration)
- **Task 006:** Context Injection (Pulling Hub-wide settings into Fletcher)

### External Documentation
- [flutter_secure_storage](https://pub.dev/packages/flutter_secure_storage)
- [iOS Keychain Services](https://developer.apple.com/documentation/security/keychain_services)
- [Android Keystore System](https://developer.android.com/training/articles/keystore)
- [Ed25519 Signatures](https://ed25519.cr.yp.to/)
- [mobile_scanner](https://pub.dev/packages/mobile_scanner)

---

**Next Steps:**
1. Review this spec with Glitch (main agent)
2. Create detailed implementation tasks for Claude Code/ACP agents
3. Implement Hub-side Vessel Key generation (Task 001)
4. Implement Flutter pairing UI & handshake (Task 004)
5. Implement Hub context injection (Task 006)
6. QA testing with real devices

---

_End of Specification_
