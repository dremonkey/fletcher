# Epic 31: Resource Delivery via Cloud Blob Store

Resolve ACP `resource_link` URIs by uploading resources to an encrypted cloud blob store and delivering signed, expiring URLs to the mobile client. The relay proxies local files to the blob store; the mobile client fetches directly from CDN. User holds the encryption keys.

## Problem

ACP agents emit `resource_link` content blocks with `file://` URIs pointing to the server filesystem. The mobile client can't access these — it's on a different device, possibly a different network. Today these render as inert metadata cards ("image.png, 1.2MB") with no way to view the content.

Inline embedding (`resource` with base64 `blob`) works for small files but breaks down for:
- Large images (>5MB base64 = ~6.7MB on the wire, chunked across the data channel)
- Video/audio files (too large for data channel)
- PDFs, datasets, any file the agent references but doesn't embed

## Goal

When an ACP agent emits a `resource_link`, the mobile client can view the content — fetched from a CDN, encrypted at rest with keys the user controls.

## Sovereignty Model

```
+------------------+     +--------------------+     +------------------+
| Relay            |     | Blob Store (R2/S3) |     | Mobile Client    |
| (your machine)   |     | (cloud, encrypted) |     | (your phone)     |
|                  |     |                    |     |                  |
| 1. Read file     |     |                    |     |                  |
| 2. Encrypt       |---->| 3. Store blob      |     |                  |
| 3. Upload        |     |    (opaque bytes)  |     |                  |
| 4. Get signed URL|     |                    |     |                  |
|                  |     |                    |     |                  |
| 5. Send signed   |     |                    |     | 6. Fetch from CDN|
|    URL to mobile |---->|                    |---->| 7. Decrypt       |
|    via data ch.  |     |                    |     | 8. Render        |
+------------------+     +--------------------+     +------------------+

Keys never leave your infrastructure.
Blob store sees only opaque encrypted bytes.
Signed URLs expire (default: 1 hour).
Blobs are garbage-collected after session ends.
```

**What makes this sovereign:**
- **Encryption keys** are generated per-session on the relay and shared with mobile via the encrypted data channel (LiveKit's DTLS). The blob store never sees plaintext.
- **Signed URLs** expire. No permanent public access.
- **Lifecycle control.** The relay deletes blobs when the session ends (or on a TTL). The user can nuke the entire bucket at any time.
- **Bring your own bucket.** Users configure their own R2/S3/GCS bucket. Fletcher never touches a shared store.
- **No Fletcher-hosted infra.** There is no Fletcher cloud service. The blob store is the user's cloud account.

## Design

### Upload Flow (Relay)

When the relay receives a `resource_link` from the ACP subprocess:

1. **Read** the file from the local filesystem (scoped to session `cwd`)
2. **Encrypt** with AES-256-GCM using a per-session content key
3. **Upload** to the configured blob store (R2, S3, GCS, or any S3-compatible)
4. **Generate** a signed URL with 1-hour expiry
5. **Rewrite** the `resource_link` before forwarding to mobile:

```json
// Before (from ACP agent):
{
  "type": "resource_link",
  "uri": "file:///home/user/project/screenshot.png",
  "name": "screenshot.png",
  "mimeType": "image/png",
  "size": 2400000
}

// After (forwarded to mobile):
{
  "type": "resource_link",
  "uri": "https://bucket.r2.cloudflarestorage.com/sess_abc/res_001?X-Amz-Signature=...",
  "name": "screenshot.png",
  "mimeType": "image/png",
  "size": 2400000,
  "_meta": {
    "fletcher.encrypted": true,
    "fletcher.key_id": "sess_abc_content_key"
  }
}
```

This is the **one place the relay stops being transparent** — it rewrites `resource_link` URIs from `file://` to signed HTTPS. All other ACP messages pass through unchanged.

### Fetch Flow (Mobile)

When the mobile client encounters a `resource_link` with an HTTPS URI:

1. **Fetch** the blob via HTTP GET (CDN-accelerated)
2. **Decrypt** with the session content key (received during `session/bind`)
3. **Dispatch** to the appropriate renderer via MIME type (Epic 30 `RendererRegistry`)

### Key Exchange

The per-session content key is exchanged during `session/bind`:

```json
// Relay → Mobile (bind response, over DTLS-encrypted data channel)
{
  "sessionKey": "...",
  "bound": true,
  "contentKey": "base64-encoded-256-bit-key"
}
```

The data channel is already encrypted by LiveKit's DTLS transport. The content key never touches the blob store or any third party.

### Blob Lifecycle

| Event | Action |
|-------|--------|
| Resource uploaded | Blob created with metadata: `sessionId`, `createdAt`, `ttl` |
| Session ends | Relay deletes all blobs for that session |
| Relay restarts | Cleanup job scans for orphaned blobs older than TTL |
| TTL expires | Blob store lifecycle rule auto-deletes (belt + suspenders) |

Default TTL: 24 hours. Configurable via `FLETCHER_RESOURCE_TTL_HOURS`.

## Phases

### Phase 1: Blob Store Integration (Relay)
- [ ] **T31.01**: `ResourceStore` interface — `upload(data, metadata) → signedUrl`, `delete(id)`, `deleteSession(sessionId)`
- [ ] **T31.02**: S3-compatible implementation (works with R2, S3, GCS, MinIO) using `@aws-sdk/client-s3`
- [ ] **T31.03**: Per-session AES-256-GCM encryption — key generation, encrypt before upload, key included in bind response
- [ ] **T31.04**: `resource_link` rewriter in relay bridge — intercept `file://` URIs, upload, rewrite to signed HTTPS URL

### Phase 2: Mobile Fetch + Decrypt
- [ ] **T31.05**: `ResourceFetcher` service — HTTP GET signed URL, decrypt with session content key, cache decoded bytes
- [ ] **T31.06**: Wire `ResourceLinkCard` (from Epic 30) to fetch on tap / auto-fetch for images
- [ ] **T31.07**: Progress indicator for large downloads, error handling for expired URLs

### Phase 3: Lifecycle + Cleanup
- [ ] **T31.08**: Session-end cleanup — relay deletes all blobs for session on teardown
- [ ] **T31.09**: Orphan cleanup on relay startup — scan for blobs older than TTL
- [ ] **T31.10**: Blob store lifecycle rule documentation (R2/S3 auto-expiry as safety net)

### Phase 4: Configuration + Docs
- [ ] **T31.11**: Environment variables: `FLETCHER_BLOB_STORE_URL`, `FLETCHER_BLOB_STORE_KEY_ID`, `FLETCHER_BLOB_STORE_KEY_SECRET`, `FLETCHER_BLOB_STORE_BUCKET`, `FLETCHER_RESOURCE_TTL_HOURS`
- [ ] **T31.12**: Documentation — setup guide for R2 (recommended), S3, MinIO (local dev)
- [ ] **T31.13**: MinIO docker-compose service for local development (no cloud account needed to develop)

## Architecture

```
ACP Agent
    |
    | session/update: resource_link (file:// URI)
    v
Relay
    |
    | ResourceStore.upload(encrypted bytes)
    v
Blob Store (R2/S3/MinIO)
    |
    | Signed HTTPS URL (1hr expiry)
    v
Relay
    |
    | Rewritten resource_link (https:// URI + encryption metadata)
    | via LiveKit data channel
    v
Mobile Client
    |
    | ResourceFetcher: HTTP GET → decrypt → Uint8List
    | RendererRegistry: dispatch by mimeType
    v
Widget (ImageRenderer, PdfRenderer, VideoRenderer, etc.)
```

## Key Decisions

1. **Encrypt before upload.** The blob store sees only opaque bytes. Even if the bucket is misconfigured or breached, content is unreadable without the session key.
2. **Signed URLs, not public access.** URLs expire after 1 hour. No permanent links.
3. **Bring your own bucket.** No Fletcher-hosted storage. The user's cloud account, the user's bill, the user's delete button.
4. **S3-compatible API.** One implementation covers R2, S3, GCS (via interop), MinIO. No provider lock-in.
5. **Relay rewrites only `resource_link`.** All other ACP messages pass through unchanged. The relay is transparent except for this one content type.
6. **MinIO for local dev.** No cloud account required during development. MinIO runs in Docker alongside LiveKit.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Upload latency delays content delivery | Medium | Upload async; send resource_link metadata immediately, mobile shows loading state |
| Signed URL expires before mobile fetches | Low | 1-hour expiry is generous; mobile can request re-signed URL from relay |
| Large files consume relay memory during encrypt+upload | Medium | Stream encrypt+upload (pipe, don't buffer entire file) |
| User doesn't configure blob store | Low | Feature is opt-in; without config, `resource_link` renders as metadata card (Epic 30 Phase 4 behavior) |
| Blob store credentials leaked | Medium | Standard secret management (`.env`, not committed); encryption means leaked creds ≠ leaked content |

## Dependencies

- Epic 30 Phase 2+ (ContentBlock model, `ResourceLinkCard`, `RendererRegistry`)
- `@aws-sdk/client-s3` (or lighter `@smithy` packages)
- LiveKit data channel for key exchange (already encrypted via DTLS)

## Non-Goals

- **Streaming large files through the data channel.** That's what the blob store solves.
- **Permanent storage / file history.** Resources are ephemeral, tied to session lifetime.
- **Fletcher-hosted cloud storage.** This is always the user's bucket.

## Success Criteria

- [ ] `resource_link` with `file://` URI results in viewable content on mobile
- [ ] Content is encrypted at rest in blob store (AES-256-GCM)
- [ ] Signed URLs expire after configured TTL
- [ ] Session teardown deletes all associated blobs
- [ ] Works with R2, S3, and MinIO (local dev)
- [ ] No blob store config → graceful degradation to metadata card
- [ ] Zero plaintext content in blob store logs or metadata
