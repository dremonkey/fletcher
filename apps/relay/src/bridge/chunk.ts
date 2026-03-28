/**
 * Payload chunking for the relay data channel.
 *
 * LiveKit data channels have a ~15KB practical limit. Large ACP payloads
 * (e.g. base64-encoded images) must be split into reassemblable chunks.
 *
 * Chunk format matches the ganglia-events pattern in EventInterceptor so
 * mobile only needs one reassembly implementation.
 */

// Maximum bytes per chunk — leaves headroom for LiveKit envelope overhead.
export const MAX_CHUNK_SIZE = 14_000;

/**
 * A single chunk message ready to be published on the data channel.
 */
export interface ChunkMessage {
  type: "chunk";
  transfer_id: string;
  chunk_index: number;
  total_chunks: number;
  data: string; // base64-encoded slice of the UTF-8 payload bytes
}

export interface ChunkOptions {
  /** Maximum chunk size in bytes. Defaults to MAX_CHUNK_SIZE (14 000). */
  maxChunkSize?: number;
}

/**
 * Split a string payload into chunk messages for data-channel delivery.
 *
 * Returns `null` when the payload fits in a single message (caller sends
 * normally). Returns an array of `ChunkMessage` objects when chunking is
 * required — caller must send each in order.
 *
 * The payload is UTF-8 encoded before splitting so multi-byte characters are
 * never split across chunk boundaries.
 */
export function chunkPayload(
  payload: string,
  options?: ChunkOptions,
): ChunkMessage[] | null {
  const maxSize = options?.maxChunkSize ?? MAX_CHUNK_SIZE;
  const bytes = new TextEncoder().encode(payload);

  if (bytes.length <= maxSize) {
    return null; // fits in one message — no chunking needed
  }

  const transferId = generateTransferId();
  const totalChunks = Math.ceil(bytes.length / maxSize);
  const chunks: ChunkMessage[] = [];

  for (let i = 0; i < totalChunks; i++) {
    const start = i * maxSize;
    const end = Math.min(start + maxSize, bytes.length);
    const slice = bytes.slice(start, end);

    chunks.push({
      type: "chunk",
      transfer_id: transferId,
      chunk_index: i,
      total_chunks: totalChunks,
      data: uint8ArrayToBase64(slice),
    });
  }

  return chunks;
}

/**
 * Reassemble chunks back into the original string payload.
 *
 * Accepts an array of `ChunkMessage` objects in any order. Returns the
 * original string on success, or throws if chunks are inconsistent or
 * any slot is missing.
 *
 * Exported for round-trip testing; production reassembly lives on mobile.
 */
export function reassembleChunks(chunks: ChunkMessage[]): string {
  if (chunks.length === 0) {
    throw new Error("No chunks provided");
  }

  const totalChunks = chunks[0].total_chunks;
  if (chunks.length !== totalChunks) {
    throw new Error(
      `Expected ${totalChunks} chunks, got ${chunks.length}`,
    );
  }

  // Sort by index so callers don't need to pre-sort
  const sorted = [...chunks].sort((a, b) => a.chunk_index - b.chunk_index);

  // Validate contiguous indices
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].chunk_index !== i) {
      throw new Error(`Missing chunk at index ${i}`);
    }
  }

  // Concatenate decoded bytes
  const allBytes: number[] = [];
  for (const chunk of sorted) {
    const decoded = base64ToUint8Array(chunk.data);
    for (const byte of decoded) {
      allBytes.push(byte);
    }
  }

  return new TextDecoder().decode(new Uint8Array(allBytes));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateTransferId(): string {
  // crypto.randomUUID() is available in Bun and modern Node
  return crypto.randomUUID();
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
