import { IncomingMessage, ServerResponse } from "http";
import { createPublicKey, verify } from "node:crypto";
import { AccessToken } from "livekit-server-sdk";
import { getLivekitRuntime } from "./runtime.js";
import { resolveLivekitAccount, getDefaultLivekitAccountId } from "./config.js";

/**
 * Request payload for token generation.
 */
interface TokenRequest {
  deviceId: string;
  timestamp: number;
  nonce: string;
  signature: string; // Base64 encoded signature
}

/**
 * Device identity storage (Prototype: In-memory).
 * In production, this would be a database lookup.
 */
interface DeviceIdentity {
  deviceId: string;
  publicKey: string; // PEM encoded or Hex
}

// TODO: Move this to a persistent store (SQLite/Postgres)
const REGISTERED_DEVICES: Map<string, DeviceIdentity> = new Map();

/**
 * Add a device for testing (Helper).
 */
export function registerDevice(deviceId: string, publicKey: string) {
  REGISTERED_DEVICES.set(deviceId, { deviceId, publicKey });
}

/**
 * Parse JSON body from IncomingMessage.
 */
function parseBody<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => {
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const body = Buffer.concat(chunks).toString();
        if (!body) return reject(new Error("Empty body"));
        resolve(JSON.parse(body));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", (err) => reject(err));
  });
}

/**
 * Send JSON response.
 */
function sendJson(res: ServerResponse, status: number, data: any) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

/**
 * Handle token generation request.
 * Verifies Ed25519 signature of the challenge.
 */
export async function handleTokenRequest(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.end();
    return;
  }

  try {
    const body: TokenRequest = await parseBody<TokenRequest>(req);
    const { deviceId, timestamp, nonce, signature } = body;

    if (!deviceId || !timestamp || !nonce || !signature) {
      sendJson(res, 400, { error: "Missing required fields" });
      return;
    }

    // 1. Verify Timestamp (Prevent Replay)
    const now = Date.now() / 1000; // Seconds
    // Allow 5 minutes drift
    if (Math.abs(now - timestamp) > 300) {
      sendJson(res, 401, { error: "Timestamp expired or invalid" });
      return;
    }

    // 2. Lookup Device
    const device = REGISTERED_DEVICES.get(deviceId);
    if (!device) {
      sendJson(res, 404, { error: "Device not found" });
      return;
    }

    // 3. Verify Signature
    // Payload reconstruction: deviceId:timestamp:nonce
    const payload = `${deviceId}:${timestamp}:${nonce}`;
    const payloadBuffer = Buffer.from(payload, "utf-8");
    const signatureBuffer = Buffer.from(signature, "base64");

    let isVerified = false;
    try {
        // Assume PEM format for stored public key
        const key = createPublicKey(device.publicKey);
        isVerified = verify(
            undefined, // Ed25519 doesn't use a digest algorithm
            payloadBuffer,
            key,
            signatureBuffer
        );
    } catch (e) {
        console.error("Verification error:", e);
        sendJson(res, 400, { error: "Invalid public key or signature format" });
        return;
    }

    if (!isVerified) {
      sendJson(res, 401, { error: "Invalid signature" });
      return;
    }

    // 4. Generate LiveKit Token
    const runtime = getLivekitRuntime();
    // Assuming config structure matches what we expect
    const config = runtime.config.loadConfig() as { channels?: { livekit?: any } };
    
    // Assume default account for simplicity
    const accountId = getDefaultLivekitAccountId(config); 
    const account = resolveLivekitAccount({ 
        cfg: config,
        accountId 
    });

    if (!account.apiKey || !account.apiSecret) {
         sendJson(res, 500, { error: "LiveKit not configured" });
         return;
    }

    const at = new AccessToken(account.apiKey, account.apiSecret, {
      identity: deviceId,
      name: deviceId, 
      ttl: 3600, // 1 hour
    });

    at.addGrant({
      roomJoin: true,
      room: "openclaw-pairing", // Default room for initial pairing/commands
      canPublish: true,
      canSubscribe: true,
    });

    const token = await at.toJwt();

    sendJson(res, 200, {
      token,
      url: account.url,
    });

  } catch (err: any) {
    console.error("Token generation error:", err);
    sendJson(res, 500, { error: err.message || "Internal server error" });
  }
}
