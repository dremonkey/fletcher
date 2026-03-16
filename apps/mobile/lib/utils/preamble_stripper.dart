import 'dart:convert';

/// Strip OpenClaw sender JSON preamble from replayed user messages (TASK-077).
///
/// OpenClaw prepends a JSON metadata line to user messages:
/// ```
/// {"sender":"device-abc","room":"foo-bar","timestamp":1234567890}
/// Actual user text here
/// ```
/// This function strips the first line if it parses as a JSON object.
String stripPreamble(String text) {
  final newlineIndex = text.indexOf('\n');
  if (newlineIndex < 0) return text;

  final firstLine = text.substring(0, newlineIndex);
  // Check if first line is a JSON object (OpenClaw metadata preamble)
  final trimmed = firstLine.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      jsonDecode(trimmed);
      // Valid JSON — strip the preamble
      return text.substring(newlineIndex + 1);
    } catch (_) {
      // Not valid JSON — keep the full text
    }
  }
  return text;
}
