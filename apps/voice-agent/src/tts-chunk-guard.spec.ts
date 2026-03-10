import { describe, it, expect } from 'bun:test';
import { guardTTSInputStream } from './tts-chunk-guard';

// ---------------------------------------------------------------------------
// Helper: build a ReadableStream<string> from an array of chunks.
// ---------------------------------------------------------------------------
function streamFrom(chunks: string[]): ReadableStream<string> {
  let idx = 0;
  return new ReadableStream<string>({
    pull(controller) {
      if (idx < chunks.length) {
        controller.enqueue(chunks[idx++]!);
      } else {
        controller.close();
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Helper: drain a ReadableStream<string> into an array of chunks.
// ---------------------------------------------------------------------------
async function drainStream(stream: ReadableStream<string>): Promise<string[]> {
  const reader = stream.getReader();
  const chunks: string[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('guardTTSInputStream', () => {
  // -------------------------------------------------------------------------
  // Buffering: leading chunks that have no word characters are suppressed.
  // -------------------------------------------------------------------------

  it('drops a leading empty string chunk', async () => {
    const chunks = await drainStream(
      guardTTSInputStream(streamFrom(['', 'Hello world'])),
    );
    expect(chunks).toEqual(['Hello world']);
  });

  it('buffers a leading whitespace-only chunk until a word arrives', async () => {
    const chunks = await drainStream(
      guardTTSInputStream(streamFrom([' ', 'Hello'])),
    );
    // Buffer " " + "Hello" = " Hello" emitted as one chunk.
    expect(chunks).toEqual([' Hello']);
  });

  it('buffers a leading period-only chunk', async () => {
    const chunks = await drainStream(
      guardTTSInputStream(streamFrom(['.', ' Hello'])),
    );
    expect(chunks).toEqual(['. Hello']);
  });

  it('buffers a leading comma', async () => {
    const chunks = await drainStream(
      guardTTSInputStream(streamFrom([',', ' world'])),
    );
    expect(chunks).toEqual([', world']);
  });

  it('buffers leading ellipsis (...)', async () => {
    const chunks = await drainStream(
      guardTTSInputStream(streamFrom(['...', ' Sure'])),
    );
    expect(chunks).toEqual(['... Sure']);
  });

  it('buffers a leading em-dash (—)', async () => {
    const chunks = await drainStream(
      guardTTSInputStream(streamFrom(['—', ' Actually'])),
    );
    expect(chunks).toEqual(['— Actually']);
  });

  it('buffers a leading opening quotation mark', async () => {
    const chunks = await drainStream(
      guardTTSInputStream(streamFrom(['"', 'Hello', '"'])),
    );
    // Buffer '"' then '"Hello' flushed, then '"' passes through.
    expect(chunks).toEqual(['"Hello', '"']);
  });

  it('buffers multiple leading punctuation chunks before a word', async () => {
    const chunks = await drainStream(
      guardTTSInputStream(streamFrom(['—', ' ', '...', ' ', 'OK'])),
    );
    // All buffered until "OK" arrives: '—' + ' ' + '...' + ' ' + 'OK'
    expect(chunks).toEqual(['— ... OK']);
  });

  it('buffers a leading hyphen', async () => {
    const chunks = await drainStream(
      guardTTSInputStream(streamFrom(['-', ' Yes'])),
    );
    expect(chunks).toEqual(['- Yes']);
  });

  // -------------------------------------------------------------------------
  // Pass-through: once a word has been seen, all subsequent chunks flow
  // immediately without buffering.
  // -------------------------------------------------------------------------

  it('passes a word-containing chunk through immediately (no buffering needed)', async () => {
    const chunks = await drainStream(
      guardTTSInputStream(streamFrom(['Hello', ',', ' world'])),
    );
    // "Hello" contains a word character — passes through as the first chunk.
    // Subsequent chunks also pass through individually.
    expect(chunks).toEqual(['Hello', ',', ' world']);
  });

  it('passes a mixed chunk through (word + punctuation)', async () => {
    const chunks = await drainStream(
      guardTTSInputStream(streamFrom(['Hello,', ' world'])),
    );
    expect(chunks).toEqual(['Hello,', ' world']);
  });

  it('passes a digit as a word character', async () => {
    const chunks = await drainStream(
      guardTTSInputStream(streamFrom([' ', '3', ' items'])),
    );
    // Buffer " " + "3" = " 3", then " items" passes through.
    expect(chunks).toEqual([' 3', ' items']);
  });

  it('passes an underscore as a word character', async () => {
    const chunks = await drainStream(
      guardTTSInputStream(streamFrom(['_foo', ' bar'])),
    );
    expect(chunks).toEqual(['_foo', ' bar']);
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  it('returns an empty stream when given an empty stream', async () => {
    const chunks = await drainStream(guardTTSInputStream(streamFrom([])));
    expect(chunks).toEqual([]);
  });

  it('flushes punctuation-only buffer if stream ends before a word', async () => {
    // An LLM response that is entirely punctuation — flush rather than drop,
    // letting the TTS handle it.
    const chunks = await drainStream(
      guardTTSInputStream(streamFrom(['...', '!'])),
    );
    expect(chunks).toEqual(['...!']);
  });

  it('handles a single word chunk with no trailing chunks', async () => {
    const chunks = await drainStream(
      guardTTSInputStream(streamFrom(['Hi'])),
    );
    expect(chunks).toEqual(['Hi']);
  });

  it('handles multiple empty string chunks before a word', async () => {
    const chunks = await drainStream(
      guardTTSInputStream(streamFrom(['', '', ' ', 'Yes'])),
    );
    // Two empty strings dropped, " " buffered, "Yes" triggers flush.
    expect(chunks).toEqual([' Yes']);
  });

  it('does not re-buffer after first word is seen', async () => {
    const chunks = await drainStream(
      guardTTSInputStream(streamFrom(['Hi', ' ', '', '.', ' there'])),
    );
    // "Hi" passes through, then all subsequent chunks pass through individually
    // (empty string chunks are not dropped post-word-seen).
    expect(chunks).toEqual(['Hi', ' ', '', '.', ' there']);
  });
});
