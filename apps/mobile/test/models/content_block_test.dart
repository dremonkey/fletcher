/// Tests for the ContentBlock sealed class hierarchy.
///
/// Covers:
/// - fromJson for each content type
/// - Unknown type fallback to RawContent
/// - Tool call `{ type: "content", content: {...} }` wrapper unwrapping
/// - Resource text vs blob variants
/// - Null/missing optional fields handled gracefully

import 'package:flutter_test/flutter_test.dart';
import 'package:fletcher/models/content_block.dart';

void main() {
  group('ContentBlock.fromJson — TextContent', () {
    test('parses minimal text block', () {
      final block = ContentBlock.fromJson({'type': 'text', 'text': 'Hello'});
      expect(block, isA<TextContent>());
      final t = block as TextContent;
      expect(t.text, 'Hello');
      expect(t.mimeType, isNull);
    });

    test('parses text block with mimeType', () {
      final block = ContentBlock.fromJson({
        'type': 'text',
        'text': '# Heading',
        'mimeType': 'text/markdown',
      });
      final t = block as TextContent;
      expect(t.text, '# Heading');
      expect(t.mimeType, 'text/markdown');
    });

    test('parses text block with text/plain mimeType', () {
      final block = ContentBlock.fromJson({
        'type': 'text',
        'text': 'plain text',
        'mimeType': 'text/plain',
      });
      final t = block as TextContent;
      expect(t.mimeType, 'text/plain');
    });
  });

  group('ContentBlock.fromJson — ImageContent', () {
    test('parses image block with required fields', () {
      final block = ContentBlock.fromJson({
        'type': 'image',
        'data': 'iVBORw0KGgo=',
        'mimeType': 'image/png',
      });
      expect(block, isA<ImageContent>());
      final img = block as ImageContent;
      expect(img.data, 'iVBORw0KGgo=');
      expect(img.mimeType, 'image/png');
      expect(img.uri, isNull);
    });

    test('parses image block with optional uri', () {
      final block = ContentBlock.fromJson({
        'type': 'image',
        'data': '/9j/4AAQ==',
        'mimeType': 'image/jpeg',
        'uri': 'file:///tmp/photo.jpg',
      });
      final img = block as ImageContent;
      expect(img.uri, 'file:///tmp/photo.jpg');
      expect(img.mimeType, 'image/jpeg');
    });
  });

  group('ContentBlock.fromJson — AudioContent', () {
    test('parses audio block', () {
      final block = ContentBlock.fromJson({
        'type': 'audio',
        'data': 'UklGRiQAAABXQVZF',
        'mimeType': 'audio/wav',
      });
      expect(block, isA<AudioContent>());
      final a = block as AudioContent;
      expect(a.data, 'UklGRiQAAABXQVZF');
      expect(a.mimeType, 'audio/wav');
    });

    test('parses audio block with mp3 mimeType', () {
      final block = ContentBlock.fromJson({
        'type': 'audio',
        'data': 'base64data==',
        'mimeType': 'audio/mp3',
      });
      final a = block as AudioContent;
      expect(a.mimeType, 'audio/mp3');
    });
  });

  group('ContentBlock.fromJson — ResourceContent', () {
    test('parses text resource (resource.text present)', () {
      final block = ContentBlock.fromJson({
        'type': 'resource',
        'resource': {
          'uri': 'file:///home/user/script.py',
          'mimeType': 'text/x-python',
          'text': "def hello():\n    print('Hello')",
        },
      });
      expect(block, isA<ResourceContent>());
      final r = block as ResourceContent;
      expect(r.uri, 'file:///home/user/script.py');
      expect(r.mimeType, 'text/x-python');
      expect(r.text, "def hello():\n    print('Hello')");
      expect(r.blob, isNull);
    });

    test('parses blob resource (resource.blob present)', () {
      final block = ContentBlock.fromJson({
        'type': 'resource',
        'resource': {
          'uri': 'file:///home/user/image.bin',
          'mimeType': 'application/octet-stream',
          'blob': 'AAAA/base64data==',
        },
      });
      final r = block as ResourceContent;
      expect(r.uri, 'file:///home/user/image.bin');
      expect(r.blob, 'AAAA/base64data==');
      expect(r.text, isNull);
    });

    test('parses resource without mimeType', () {
      final block = ContentBlock.fromJson({
        'type': 'resource',
        'resource': {
          'uri': 'file:///home/user/data.txt',
          'text': 'some content',
        },
      });
      final r = block as ResourceContent;
      expect(r.mimeType, isNull);
      expect(r.text, 'some content');
    });
  });

  group('ContentBlock.fromJson — ResourceLinkContent', () {
    test('parses resource_link with all fields', () {
      final block = ContentBlock.fromJson({
        'type': 'resource_link',
        'uri': 'file:///home/user/document.pdf',
        'name': 'document.pdf',
        'mimeType': 'application/pdf',
        'title': 'My Document',
        'description': 'A PDF document',
        'size': 1024000,
      });
      expect(block, isA<ResourceLinkContent>());
      final rl = block as ResourceLinkContent;
      expect(rl.uri, 'file:///home/user/document.pdf');
      expect(rl.name, 'document.pdf');
      expect(rl.mimeType, 'application/pdf');
      expect(rl.title, 'My Document');
      expect(rl.description, 'A PDF document');
      expect(rl.size, 1024000);
    });

    test('parses resource_link with only required fields', () {
      final block = ContentBlock.fromJson({
        'type': 'resource_link',
        'uri': 'https://example.com/file.txt',
        'name': 'file.txt',
      });
      final rl = block as ResourceLinkContent;
      expect(rl.uri, 'https://example.com/file.txt');
      expect(rl.name, 'file.txt');
      expect(rl.mimeType, isNull);
      expect(rl.title, isNull);
      expect(rl.description, isNull);
      expect(rl.size, isNull);
    });
  });

  group('ContentBlock.fromJson — DiffContent', () {
    test('parses diff block with oldText and newText', () {
      final block = ContentBlock.fromJson({
        'type': 'diff',
        'path': '/home/user/project/src/config.json',
        'oldText': '{"debug": false}',
        'newText': '{"debug": true}',
      });
      expect(block, isA<DiffContent>());
      final d = block as DiffContent;
      expect(d.path, '/home/user/project/src/config.json');
      expect(d.oldText, '{"debug": false}');
      expect(d.newText, '{"debug": true}');
    });

    test('parses diff block for new file (oldText is null)', () {
      final block = ContentBlock.fromJson({
        'type': 'diff',
        'path': '/home/user/project/new_file.ts',
        'newText': 'export const hello = () => "hello";',
      });
      final d = block as DiffContent;
      expect(d.oldText, isNull);
      expect(d.newText, 'export const hello = () => "hello";');
    });
  });

  group('ContentBlock.fromJson — TerminalContent', () {
    test('parses terminal block', () {
      final block = ContentBlock.fromJson({
        'type': 'terminal',
        'terminalId': 'term_xyz789',
      });
      expect(block, isA<TerminalContent>());
      final t = block as TerminalContent;
      expect(t.terminalId, 'term_xyz789');
    });
  });

  group('ContentBlock.fromJson — tool call content wrapper', () {
    test('unwraps { type: "content", content: text_block } to TextContent', () {
      final block = ContentBlock.fromJson({
        'type': 'content',
        'content': {
          'type': 'text',
          'text': 'Found 3 configuration files...',
        },
      });
      expect(block, isA<TextContent>());
      final t = block as TextContent;
      expect(t.text, 'Found 3 configuration files...');
    });

    test('unwraps content wrapper containing an image block', () {
      final block = ContentBlock.fromJson({
        'type': 'content',
        'content': {
          'type': 'image',
          'data': 'iVBORw0KGgo=',
          'mimeType': 'image/png',
        },
      });
      expect(block, isA<ImageContent>());
    });

    test('unwraps content wrapper containing a resource_link block', () {
      final block = ContentBlock.fromJson({
        'type': 'content',
        'content': {
          'type': 'resource_link',
          'uri': 'file:///home/user/report.pdf',
          'name': 'report.pdf',
        },
      });
      expect(block, isA<ResourceLinkContent>());
    });
  });

  group('ContentBlock.fromJson — RawContent fallback', () {
    test('unknown type returns RawContent', () {
      final json = {'type': 'future_type', 'data': 'something'};
      final block = ContentBlock.fromJson(json);
      expect(block, isA<RawContent>());
      final raw = block as RawContent;
      expect(raw.json, json);
    });

    test('missing type returns RawContent', () {
      final json = {'data': 'something'};
      final block = ContentBlock.fromJson(json);
      expect(block, isA<RawContent>());
      final raw = block as RawContent;
      expect(raw.json, json);
    });

    test('empty type string returns RawContent', () {
      final json = {'type': ''};
      final block = ContentBlock.fromJson(json);
      expect(block, isA<RawContent>());
    });

    test('RawContent preserves entire original json payload', () {
      final json = {
        'type': 'unknown_future',
        'someField': 42,
        'nested': {'key': 'value'},
      };
      final raw = ContentBlock.fromJson(json) as RawContent;
      expect(raw.json['someField'], 42);
      expect((raw.json['nested'] as Map)['key'], 'value');
    });
  });

  group('ContentBlock sealed class exhaustiveness', () {
    // These tests confirm each variant is correctly typed, which lets the Dart
    // analyser enforce exhaustive switch coverage at call sites.
    test('every variant is a ContentBlock', () {
      final List<ContentBlock> blocks = [
        const TextContent(text: 'hi'),
        const ImageContent(data: 'abc', mimeType: 'image/png'),
        const AudioContent(data: 'abc', mimeType: 'audio/wav'),
        const ResourceContent(uri: 'file:///foo'),
        const ResourceLinkContent(uri: 'file:///foo', name: 'foo'),
        const DiffContent(path: '/foo', newText: 'bar'),
        const TerminalContent(terminalId: 'term_1'),
        const RawContent(json: {'type': 'x'}),
      ];
      expect(blocks, everyElement(isA<ContentBlock>()));
    });
  });
}
