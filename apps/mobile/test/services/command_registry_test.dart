import 'package:flutter_test/flutter_test.dart';
import 'package:fletcher/services/command_registry.dart';
import 'package:fletcher/models/command_result.dart';

void main() {
  group('CommandRegistry', () {
    late CommandRegistry registry;

    setUp(() {
      registry = CommandRegistry();
    });

    test('/help returns list of registered commands', () async {
      final result = await registry.dispatch('/help');
      expect(result, isNotNull);
      expect(result!.command, 'help');
      expect(result.text, contains('/help'));
      expect(result.isError, isFalse);
    });

    test('unknown command returns error result', () async {
      final result = await registry.dispatch('/nonexistent');
      expect(result, isNotNull);
      expect(result!.command, 'nonexistent');
      expect(result.isError, isTrue);
      expect(result.text, contains('Unknown command'));
      expect(result.text, contains('/help'));
    });

    test('case-insensitive dispatch', () async {
      final result = await registry.dispatch('/HELP');
      expect(result, isNotNull);
      expect(result!.command, 'help');
      expect(result.isError, isFalse);
    });

    test('whitespace trimming after slash', () async {
      final result = await registry.dispatch('/  help');
      expect(result, isNotNull);
      expect(result!.command, 'help');
      expect(result.isError, isFalse);
    });

    test('bare "/" returns null', () async {
      final result = await registry.dispatch('/');
      expect(result, isNull);
    });

    test('args parsing: "/cmd foo bar" splits correctly', () async {
      String? capturedArgs;
      registry.register('test', (args) async {
        capturedArgs = args;
        return CommandResult(
          command: 'test',
          text: 'ok',
          timestamp: DateTime.now(),
        );
      });

      await registry.dispatch('/test foo bar');
      expect(capturedArgs, 'foo bar');
    });

    test('handler exception returns error result', () async {
      registry.register('boom', (_) async {
        throw Exception('kaboom');
      });

      final result = await registry.dispatch('/boom');
      expect(result, isNotNull);
      expect(result!.isError, isTrue);
      expect(result.text, contains('Command failed'));
      expect(result.text, contains('kaboom'));
    });

    test('handler returning null produces no result', () async {
      registry.register('silent', (_) async => null);

      final result = await registry.dispatch('/silent');
      expect(result, isNull);
    });

    test('registeredCommands lists all commands', () {
      expect(registry.registeredCommands, contains('help'));
      registry.register('test', (_) async => null);
      expect(registry.registeredCommands, contains('test'));
    });
  });
}
