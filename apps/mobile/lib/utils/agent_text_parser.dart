/// Parser for OpenClaw's `<think>` / `<final>` XML tags in agent messages.
///
/// This parser is **stateless** — it re-parses the full accumulated string on
/// each render. Streaming-awareness comes from partial tag holding: if the
/// string ends with a prefix of a known tag (e.g. `<thi`), that suffix is
/// stripped from output so raw XML never flashes in the UI.
///
/// Supports both live `session/update` streaming and `session/load` replay.
library;

/// Indicates the state of the `<think>` block within a parsed agent message.
enum ThinkingState {
  /// No `<think>` tag was found.
  none,

  /// `<think>` was found but `</think>` has not arrived yet (streaming).
  inProgress,

  /// Both `<think>` and `</think>` were found (thinking is complete).
  complete,
}

/// The result of parsing an agent message string.
class ParsedAgentText {
  /// Content inside `<think>...</think>`. Null if absent or empty after trim.
  final String? thinking;

  /// State of the thinking block.
  final ThinkingState thinkingState;

  /// Content to display as the main agent response. Either the content inside
  /// `<final>...</final>`, the text after `</think>` when no `<final>` tag is
  /// present, or the full raw string when no tags are present.
  final String visible;

  const ParsedAgentText({
    this.thinking,
    this.thinkingState = ThinkingState.none,
    this.visible = '',
  });
}

/// Parse an agent message string, extracting `<think>` and `<final>` sections.
///
/// **Streaming-safe**: partial tag suffixes (e.g. `<thi`, `<fin`) are held
/// (stripped from output) so raw XML is never visible during streaming.
///
/// **Graceful**: malformed or unexpected tag structures fall back to returning
/// the raw text as [ParsedAgentText.visible] with [ThinkingState.none].
ParsedAgentText parseAgentText(String raw) {
  if (raw.isEmpty) {
    return const ParsedAgentText(visible: '');
  }

  const thinkOpen = '<think>';
  const thinkClose = '</think>';
  const finalOpen = '<final>';
  const finalClose = '</final>';

  // --- Step 1: Look for <think> ---
  final thinkStart = raw.indexOf(thinkOpen);
  if (thinkStart == -1) {
    // No <think> tag — check for standalone <final> tag (no think block).
    final finalOnlyStart = raw.indexOf(finalOpen);
    if (finalOnlyStart != -1) {
      final finalOnlyContentStart = finalOnlyStart + finalOpen.length;
      final finalOnlyCloseIdx = raw.indexOf(finalClose, finalOnlyContentStart);
      if (finalOnlyCloseIdx != -1) {
        // Complete <final>...</final> with no <think>: extract visible text.
        final visibleContent =
            raw.substring(finalOnlyContentStart, finalOnlyCloseIdx).trim();
        return ParsedAgentText(
          thinkingState: ThinkingState.none,
          visible: visibleContent,
        );
      } else {
        // Unclosed <final> — visible is streaming content after the tag.
        final visibleContent =
            raw.substring(finalOnlyContentStart).trim();
        return ParsedAgentText(
          thinkingState: ThinkingState.none,
          visible: visibleContent,
        );
      }
    }
    // No tags at all — strip partial tag suffix and return as visible.
    final stripped = _stripPartialTag(raw);
    return ParsedAgentText(
      thinkingState: ThinkingState.none,
      visible: stripped.trim(),
    );
  }

  // --- Step 2: We have <think>. Look for </think> ---
  final thinkContentStart = thinkStart + thinkOpen.length;
  final thinkCloseIdx = raw.indexOf(thinkClose, thinkContentStart);

  if (thinkCloseIdx == -1) {
    // <think> open but not closed — streaming, in progress.
    final thinkContent = raw.substring(thinkContentStart).trim();
    return ParsedAgentText(
      thinking: thinkContent.isEmpty ? null : thinkContent,
      thinkingState: ThinkingState.inProgress,
      visible: '',
    );
  }

  // Both <think> and </think> found.
  final thinkContent =
      raw.substring(thinkContentStart, thinkCloseIdx).trim();

  // --- Step 3: Look for <final> in remainder after </think> ---
  final afterThinkClose = thinkCloseIdx + thinkClose.length;
  final remainder = raw.substring(afterThinkClose);

  final finalStart = remainder.indexOf(finalOpen);
  if (finalStart == -1) {
    // No <final> tag. The remainder (minus partial tag hold) is visible text.
    final strippedRemainder = _stripPartialTag(remainder).trim();
    return ParsedAgentText(
      thinking: thinkContent.isEmpty ? null : thinkContent,
      thinkingState: ThinkingState.complete,
      visible: strippedRemainder,
    );
  }

  // --- Step 4: <final> found. Look for </final> ---
  final finalContentStart = finalStart + finalOpen.length;
  final finalCloseIdx = remainder.indexOf(finalClose, finalContentStart);

  if (finalCloseIdx == -1) {
    // <final> open but not closed — visible text is streaming.
    // Strip any partial tag suffix (e.g. </fin) that hasn't been confirmed.
    final rawVisible = remainder.substring(finalContentStart);
    final visibleContent = _stripPartialTag(rawVisible).trim();
    return ParsedAgentText(
      thinking: thinkContent.isEmpty ? null : thinkContent,
      thinkingState: ThinkingState.complete,
      visible: visibleContent,
    );
  }

  // Both <final> and </final> found — complete message.
  final visibleContent =
      remainder.substring(finalContentStart, finalCloseIdx).trim();

  return ParsedAgentText(
    thinking: thinkContent.isEmpty ? null : thinkContent,
    thinkingState: ThinkingState.complete,
    visible: visibleContent,
  );
}

/// Strips a trailing partial tag match from [text].
///
/// If [text] ends with a prefix of any known tag (`<think>`, `</think>`,
/// `<final>`, `</final>`), that prefix is removed. This prevents partial XML
/// tags from appearing in the UI during streaming.
///
/// Only prefixes of length 1..tag.length-1 are considered (a full tag string
/// is not a "partial" match — it is a confirmed tag).
String _stripPartialTag(String text) {
  const tags = ['<think>', '</think>', '<final>', '</final>'];
  for (final tag in tags) {
    // Check from longest to shortest prefix to match the most specific suffix.
    for (int len = tag.length - 1; len >= 1; len--) {
      if (text.endsWith(tag.substring(0, len))) {
        return text.substring(0, text.length - len);
      }
    }
  }
  return text;
}
