import { describe, test, expect } from "bun:test";
import { chunkPayload, reassembleChunks, MAX_CHUNK_SIZE } from "./chunk";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a string of exactly `n` ASCII characters. */
function makePayload(n: number): string {
  return "A".repeat(n);
}

/** Build a payload whose UTF-8 byte length is exactly `n`. */
function makePayloadBytes(n: number): string {
  return "B".repeat(n);
}

// ---------------------------------------------------------------------------
// chunkPayload
// ---------------------------------------------------------------------------

describe("chunkPayload", () => {
  test("returns null for a payload under the limit", () => {
    const payload = makePayload(MAX_CHUNK_SIZE - 1);
    expect(chunkPayload(payload)).toBeNull();
  });

  test("returns null for a payload exactly at the limit", () => {
    const payload = makePayload(MAX_CHUNK_SIZE);
    expect(chunkPayload(payload)).toBeNull();
  });

  test("returns chunks for a payload one byte over the limit", () => {
    const payload = makePayload(MAX_CHUNK_SIZE + 1);
    const chunks = chunkPayload(payload);
    expect(chunks).not.toBeNull();
    expect(chunks!.length).toBe(2);
  });

  test("splits a 3× payload into 3 chunks", () => {
    const payload = makePayloadBytes(MAX_CHUNK_SIZE * 3);
    const chunks = chunkPayload(payload);
    expect(chunks).not.toBeNull();
    expect(chunks!.length).toBe(3);
  });

  test("all chunks share the same transferId", () => {
    const payload = makePayload(MAX_CHUNK_SIZE * 2 + 1);
    const chunks = chunkPayload(payload)!;
    const ids = new Set(chunks.map((c) => c.transfer_id));
    expect(ids.size).toBe(1);
  });

  test("chunk indices are sequential from 0", () => {
    const payload = makePayload(MAX_CHUNK_SIZE * 3 + 1);
    const chunks = chunkPayload(payload)!;
    chunks.forEach((c, i) => {
      expect(c.chunk_index).toBe(i);
    });
  });

  test("total_chunks matches actual chunk count", () => {
    const payload = makePayload(MAX_CHUNK_SIZE * 4 + 1);
    const chunks = chunkPayload(payload)!;
    chunks.forEach((c) => {
      expect(c.total_chunks).toBe(chunks.length);
    });
  });

  test("each chunk has type='chunk'", () => {
    const payload = makePayload(MAX_CHUNK_SIZE * 2 + 1);
    const chunks = chunkPayload(payload)!;
    chunks.forEach((c) => {
      expect(c.type).toBe("chunk");
    });
  });

  test("chunk data field is a non-empty base64 string", () => {
    const payload = makePayload(MAX_CHUNK_SIZE + 1);
    const chunks = chunkPayload(payload)!;
    const b64Pattern = /^[A-Za-z0-9+/]+=*$/;
    chunks.forEach((c) => {
      expect(typeof c.data).toBe("string");
      expect(c.data.length).toBeGreaterThan(0);
      expect(b64Pattern.test(c.data)).toBe(true);
    });
  });

  test("respects custom maxChunkSize option", () => {
    const smallMax = 100;
    const payload = makePayload(250);
    const chunks = chunkPayload(payload, { maxChunkSize: smallMax })!;
    expect(chunks).not.toBeNull();
    expect(chunks.length).toBe(3); // ceil(250 / 100)
  });

  test("returns null when custom maxChunkSize exceeds payload length", () => {
    const payload = makePayload(50);
    expect(chunkPayload(payload, { maxChunkSize: 1000 })).toBeNull();
  });

  test("generateTransferId produces unique IDs across calls", () => {
    const payload = makePayload(MAX_CHUNK_SIZE + 1);
    const chunks1 = chunkPayload(payload)!;
    const chunks2 = chunkPayload(payload)!;
    expect(chunks1[0].transfer_id).not.toBe(chunks2[0].transfer_id);
  });
});

// ---------------------------------------------------------------------------
// reassembleChunks
// ---------------------------------------------------------------------------

describe("reassembleChunks", () => {
  test("round-trip: chunk then reassemble returns original payload", () => {
    const original = makePayload(MAX_CHUNK_SIZE * 2 + 500);
    const chunks = chunkPayload(original)!;
    const reassembled = reassembleChunks(chunks);
    expect(reassembled).toBe(original);
  });

  test("round-trip with Unicode payload", () => {
    // Multi-byte UTF-8 characters
    const original = "こんにちは世界".repeat(10_000);
    const chunks = chunkPayload(original)!;
    expect(chunks).not.toBeNull();
    const reassembled = reassembleChunks(chunks);
    expect(reassembled).toBe(original);
  });

  test("reassembles chunks arriving out of order", () => {
    const original = makePayload(MAX_CHUNK_SIZE * 3 + 1);
    const chunks = chunkPayload(original)!;
    // Reverse order
    const reversed = [...chunks].reverse();
    const reassembled = reassembleChunks(reversed);
    expect(reassembled).toBe(original);
  });

  test("reassembles chunks in shuffled order", () => {
    const original = makePayload(MAX_CHUNK_SIZE * 4 + 1);
    const chunks = chunkPayload(original)!;
    // Shuffle: move last to front
    const shuffled = [chunks[chunks.length - 1], ...chunks.slice(0, -1)];
    const reassembled = reassembleChunks(shuffled);
    expect(reassembled).toBe(original);
  });

  test("throws when chunk count mismatches total_chunks", () => {
    const original = makePayload(MAX_CHUNK_SIZE * 3 + 1);
    const chunks = chunkPayload(original)!;
    // Drop one chunk
    const incomplete = chunks.slice(0, 2);
    expect(() => reassembleChunks(incomplete)).toThrow();
  });

  test("throws when given an empty array", () => {
    expect(() => reassembleChunks([])).toThrow();
  });

  test("round-trip produces exactly the original JSON payload", () => {
    const original = JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        content: [{ type: "image_url", url: "data:image/png;base64," + "x".repeat(30_000) }],
      },
    });
    const chunks = chunkPayload(original)!;
    expect(chunks).not.toBeNull();
    const reassembled = reassembleChunks(chunks);
    expect(reassembled).toBe(original);
  });
});
