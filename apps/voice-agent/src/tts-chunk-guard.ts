/**
 * TTS Empty Chunk Guard — filters leading punctuation/whitespace-only chunks
 * from the TTS input stream.
 *
 * Many TTS engines (Cartesia, ElevenLabs, etc.) reject an initial chunk that
 * contains no word characters — only whitespace, punctuation, or an empty
 * string.  The LLM often produces such chunks at the start of a response:
 *   - Role-only deltas (no content)
 *   - Punctuation openers: `"`, `—`, `...`, `, `
 *   - Whitespace-only chunks: `" "`, `"\n"`
 *
 * This guard buffers all initial chunks until the accumulated text contains
 * at least one word character (/\w/ — letter, digit, or underscore).  At that
 * point the entire buffer is flushed as a single chunk, and subsequent chunks
 * pass through immediately.
 *
 * The guard is provider-agnostic and operates on the raw ReadableStream<string>
 * that the voice pipeline routes from LLM output to TTS input.
 *
 * Usage:
 *   The guard is applied by subclassing voice.Agent and overriding ttsNode():
 *
 *     class GuardedAgent extends voice.Agent {
 *       override async ttsNode(text, modelSettings) {
 *         return super.ttsNode(guardTTSInputStream(text), modelSettings);
 *       }
 *     }
 */

/**
 * Wraps a ReadableStream<string> to buffer leading punctuation/whitespace-only
 * chunks before they reach the TTS engine.
 *
 * Buffering rules:
 * - If the chunk contains no word character (/\w/), it is buffered.
 * - Once a chunk (or the accumulated buffer) contains a word character,
 *   the buffer is flushed as a single chunk, then all subsequent chunks
 *   pass through immediately without buffering.
 * - Empty string chunks are silently dropped (they carry no text content
 *   and would cause errors in strict TTS engines).
 *
 * @param text - Upstream ReadableStream<string> from the LLM output pipeline.
 * @returns A new ReadableStream<string> with leading punctuation suppressed.
 */
export function guardTTSInputStream(text: ReadableStream<string>): ReadableStream<string> {
  const reader = text.getReader();
  let wordSeen = false;
  let buffer = '';

  return new ReadableStream<string>({
    async pull(controller) {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          // Stream ended — flush any buffered content (even punctuation-only)
          // so the TTS does not silently drop the response.  If the entire
          // response was punctuation-only, flush it rather than swallowing it:
          // the TTS may handle it gracefully (or error), but at least we tried.
          if (!wordSeen && buffer.length > 0) {
            controller.enqueue(buffer);
          }
          controller.close();
          return;
        }

        if (wordSeen) {
          // Fast path: word already seen, pass through immediately.
          // Do not drop empty strings here — let the TTS handle them.
          controller.enqueue(value);
          return;
        }

        // Drop empty-string chunks in the pre-word buffering phase — they
        // carry no content and would only pollute the accumulated buffer.
        if (value === '') {
          continue;
        }

        // Slow path: still buffering until first word character.
        buffer += value;

        if (/\w/.test(buffer)) {
          // Word found — flush the buffer and switch to pass-through mode.
          wordSeen = true;
          controller.enqueue(buffer);
          buffer = '';
          return;
        }

        // Buffer does not yet contain a word — continue reading.
      }
    },

    cancel(reason) {
      reader.cancel(reason);
    },
  });
}
