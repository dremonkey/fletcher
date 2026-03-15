import '../models/command_result.dart';

typedef CommandHandler = Future<CommandResult?> Function(String args);

class CommandRegistry {
  final Map<String, CommandHandler> _commands = {};

  CommandRegistry() {
    // Register built-in commands
    register('help', _helpHandler);
  }

  void register(String name, CommandHandler handler) {
    _commands[name.toLowerCase()] = handler;
  }

  /// Parse and dispatch a slash command input.
  /// Input should include the leading `/` (e.g. "/help", "/sessions foo").
  /// Returns null if input is bare `/` (caller should treat as regular text).
  Future<CommandResult?> dispatch(String input) async {
    // Strip leading '/' and trim
    final body = input.substring(1).trim();
    if (body.isEmpty) return null; // bare "/" → treat as regular text

    // Split on first space: command + args
    final spaceIndex = body.indexOf(' ');
    final command = (spaceIndex == -1 ? body : body.substring(0, spaceIndex)).toLowerCase();
    final args = spaceIndex == -1 ? '' : body.substring(spaceIndex + 1).trim();

    final handler = _commands[command];
    if (handler == null) {
      return CommandResult(
        command: command,
        text: 'Unknown command: /$command\nType /help for available commands.',
        timestamp: DateTime.now(),
        isError: true,
      );
    }

    try {
      return await handler(args);
    } catch (e) {
      return CommandResult(
        command: command,
        text: 'Command failed: $e',
        timestamp: DateTime.now(),
        isError: true,
      );
    }
  }

  List<String> get registeredCommands => List.unmodifiable(_commands.keys);

  Future<CommandResult?> _helpHandler(String args) async {
    final cmds = registeredCommands.map((c) => '/$c').join(', ');
    return CommandResult(
      command: 'help',
      text: 'Available commands: $cmds',
      timestamp: DateTime.now(),
    );
  }
}
