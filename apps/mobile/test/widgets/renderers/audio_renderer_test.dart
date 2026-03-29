import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fletcher/models/content_block.dart';
import 'package:fletcher/widgets/renderers/audio_renderer.dart';

Widget _wrap(Widget child) {
  return MaterialApp(
    home: Scaffold(
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: child,
      ),
    ),
  );
}

/// Build an [AudioContent] block for testing.
AudioContent _makeAudio({
  String data = 'AAAA', // 4 chars → ~3 decoded bytes
  String mimeType = 'audio/wav',
}) {
  return AudioContent(data: data, mimeType: mimeType);
}

void main() {
  group('AudioRenderer — metadata card', () {
    testWidgets('renders without error for a minimal audio block',
        (tester) async {
      final block = _makeAudio();
      await tester.pumpWidget(_wrap(AudioRenderer(block: block)));

      expect(find.byType(AudioRenderer), findsOneWidget);
    });

    testWidgets('displays the MIME type', (tester) async {
      final block = _makeAudio(mimeType: 'audio/wav');
      await tester.pumpWidget(_wrap(AudioRenderer(block: block)));

      expect(find.text('audio/wav'), findsOneWidget);
    });

    testWidgets('displays different MIME types', (tester) async {
      final block = _makeAudio(mimeType: 'audio/mpeg');
      await tester.pumpWidget(_wrap(AudioRenderer(block: block)));

      expect(find.text('audio/mpeg'), findsOneWidget);
    });

    testWidgets('displays decoded size label', (tester) async {
      // 'AAAA' = 4 base64 chars → 4 * 0.75 = 3 bytes → "3 B"
      final block = _makeAudio(data: 'AAAA');
      await tester.pumpWidget(_wrap(AudioRenderer(block: block)));

      expect(find.text('3 B'), findsOneWidget);
    });

    testWidgets('size label uses KB for larger data', (tester) async {
      // 4096 base64 chars → 4096 * 0.75 = 3072 bytes = 3.0 KB
      final data = 'A' * 4096;
      final block = _makeAudio(data: data);
      await tester.pumpWidget(_wrap(AudioRenderer(block: block)));

      expect(find.text('3.0 KB'), findsOneWidget);
    });

    testWidgets('size label uses MB for large data', (tester) async {
      // 2 * 1024 * 1024 / 0.75 ≈ 2796202 chars → ~2.0 MB
      final data = 'A' * (2 * 1024 * 1024 ~/ 3 * 4); // ~2MB decoded
      final block = _makeAudio(data: data);
      await tester.pumpWidget(_wrap(AudioRenderer(block: block)));

      // Just check it contains "MB"
      expect(find.textContaining('MB'), findsOneWidget);
    });

    testWidgets('shows an audio icon', (tester) async {
      final block = _makeAudio();
      await tester.pumpWidget(_wrap(AudioRenderer(block: block)));

      expect(find.byIcon(Icons.audio_file), findsOneWidget);
    });

    testWidgets('shows a play button', (tester) async {
      final block = _makeAudio();
      await tester.pumpWidget(_wrap(AudioRenderer(block: block)));

      expect(find.byIcon(Icons.play_arrow), findsOneWidget);
    });

    testWidgets('play button has play audio semantics label', (tester) async {
      final block = _makeAudio();
      await tester.pumpWidget(_wrap(AudioRenderer(block: block)));

      final icon = tester.widget<Icon>(find.byIcon(Icons.play_arrow));
      expect(icon.semanticLabel, 'Play audio');
    });
  });

  group('AudioRenderer — size calculation', () {
    test('decodedSize rounds base64 length × 0.75', () {
      // 4 chars → 3 bytes
      expect(_makeAudio(data: 'AAAA').decodedSize, equals(3));
      // 8 chars → 6 bytes
      expect(_makeAudio(data: 'AAAAAAAA').decodedSize, equals(6));
      // 3 chars → rounds 2.25 → 2 bytes
      expect(_makeAudio(data: 'AAA').decodedSize, equals(2));
    });

    test('empty data has decodedSize of 0', () {
      expect(_makeAudio(data: '').decodedSize, equals(0));
    });

    testWidgets('zero-byte audio shows "0 B"', (tester) async {
      final block = _makeAudio(data: '');
      await tester.pumpWidget(_wrap(AudioRenderer(block: block)));

      expect(find.text('0 B'), findsOneWidget);
    });
  });

  group('AudioContent model', () {
    test('fromJson parses audio block correctly', () {
      final json = <String, dynamic>{
        'type': 'audio',
        'data': 'SGVsbG8=',
        'mimeType': 'audio/wav',
      };
      final block = ContentBlock.fromJson(json);

      expect(block, isA<AudioContent>());
      final audio = block as AudioContent;
      expect(audio.data, equals('SGVsbG8='));
      expect(audio.mimeType, equals('audio/wav'));
    });

    test('fromJson defaults mimeType to audio/wav when missing', () {
      final json = <String, dynamic>{
        'type': 'audio',
        'data': 'AAAA',
      };
      final block = ContentBlock.fromJson(json) as AudioContent;
      expect(block.mimeType, equals('audio/wav'));
    });

    test('equality holds for identical blocks', () {
      final a = AudioContent(data: 'AAAA', mimeType: 'audio/wav');
      final b = AudioContent(data: 'AAAA', mimeType: 'audio/wav');
      expect(a, equals(b));
    });

    test('equality fails for different data', () {
      final a = AudioContent(data: 'AAAA', mimeType: 'audio/wav');
      final b = AudioContent(data: 'BBBB', mimeType: 'audio/wav');
      expect(a, isNot(equals(b)));
    });

    test('equality fails for different mimeType', () {
      final a = AudioContent(data: 'AAAA', mimeType: 'audio/wav');
      final b = AudioContent(data: 'AAAA', mimeType: 'audio/mpeg');
      expect(a, isNot(equals(b)));
    });
  });
}
