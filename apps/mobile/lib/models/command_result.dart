/// Result of a slash command execution, displayed as an inline card in the
/// chat transcript.
class CommandResult {
  final String command;     // e.g. "help", "sessions"
  final String text;        // display text (may contain newlines)
  final DateTime timestamp;
  final bool isError;       // true for unknown commands / handler failures

  const CommandResult({
    required this.command,
    required this.text,
    required this.timestamp,
    this.isError = false,
  });
}
