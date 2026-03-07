import 'package:flutter_test/flutter_test.dart';

import 'package:fletcher/models/conversation_state.dart';

void main() {
  group('ArtifactEvent.messageId', () {
    test('defaults to null', () {
      const artifact = ArtifactEvent(artifactType: ArtifactType.code);
      expect(artifact.messageId, isNull);
    });

    test('can be set via constructor', () {
      const artifact = ArtifactEvent(
        artifactType: ArtifactType.code,
        messageId: 'seg-001',
      );
      expect(artifact.messageId, 'seg-001');
    });

    test('withMessageId returns copy with new messageId', () {
      const artifact = ArtifactEvent(
        artifactType: ArtifactType.diff,
        title: 'changes.dart',
        file: 'lib/main.dart',
      );

      final stamped = artifact.withMessageId('seg-002');
      expect(stamped.messageId, 'seg-002');
      // Original fields preserved
      expect(stamped.artifactType, ArtifactType.diff);
      expect(stamped.title, 'changes.dart');
      expect(stamped.file, 'lib/main.dart');
    });

    test('withMessageId(null) clears the messageId', () {
      const artifact = ArtifactEvent(
        artifactType: ArtifactType.code,
        messageId: 'seg-001',
      );

      final cleared = artifact.withMessageId(null);
      expect(cleared.messageId, isNull);
    });

    test('withMessageId preserves all fields', () {
      final results = [
        const SearchResult(file: 'a.dart', line: 10, content: 'foo'),
      ];
      final artifact = ArtifactEvent(
        artifactType: ArtifactType.searchResults,
        title: 'Search',
        file: 'test.dart',
        diff: '+line',
        language: 'dart',
        content: 'void main() {}',
        startLine: 1,
        path: '/src/test.dart',
        query: 'main',
        results: results,
        message: 'error msg',
        stack: 'stack trace',
        rawJson: const {'key': 'value'},
        messageId: 'seg-old',
      );

      final stamped = artifact.withMessageId('seg-new');
      expect(stamped.messageId, 'seg-new');
      expect(stamped.artifactType, ArtifactType.searchResults);
      expect(stamped.title, 'Search');
      expect(stamped.file, 'test.dart');
      expect(stamped.diff, '+line');
      expect(stamped.language, 'dart');
      expect(stamped.content, 'void main() {}');
      expect(stamped.startLine, 1);
      expect(stamped.path, '/src/test.dart');
      expect(stamped.query, 'main');
      expect(stamped.results, results);
      expect(stamped.message, 'error msg');
      expect(stamped.stack, 'stack trace');
      expect(stamped.rawJson, {'key': 'value'});
    });

    test('fromJson does not set messageId (server does not send it)', () {
      final json = {
        'type': 'artifact',
        'artifact_type': 'code',
        'title': 'test.dart',
        'content': 'hello',
      };

      final artifact = ArtifactEvent.fromJson(json);
      expect(artifact.messageId, isNull);
      expect(artifact.title, 'test.dart');
    });
  });

  group('Artifact-message grouping logic', () {
    // Replicate the grouping logic from ChatTranscript to unit-test it
    // without needing a widget test with LiveKitService.
    Map<String, List<ArtifactEvent>> groupArtifactsByMessage(
      List<ArtifactEvent> artifacts,
      List<TranscriptEntry> transcript,
    ) {
      final groups = <String, List<ArtifactEvent>>{};
      if (artifacts.isEmpty) return groups;

      String? lastAgentId;
      for (int i = transcript.length - 1; i >= 0; i--) {
        if (transcript[i].role == TranscriptRole.agent) {
          lastAgentId = transcript[i].id;
          break;
        }
      }

      for (final artifact in artifacts) {
        final targetId = artifact.messageId ?? lastAgentId;
        if (targetId != null) {
          groups.putIfAbsent(targetId, () => []);
          groups[targetId]!.add(artifact);
        }
      }

      return groups;
    }

    final now = DateTime.now();

    test('empty artifacts returns empty map', () {
      final transcript = [
        TranscriptEntry(
          id: 'seg-1',
          role: TranscriptRole.agent,
          text: 'Hello',
          timestamp: now,
        ),
      ];

      final result = groupArtifactsByMessage([], transcript);
      expect(result, isEmpty);
    });

    test('artifacts with messageId group under their message', () {
      final transcript = [
        TranscriptEntry(
          id: 'seg-1',
          role: TranscriptRole.agent,
          text: 'First response',
          timestamp: now,
        ),
        TranscriptEntry(
          id: 'seg-2',
          role: TranscriptRole.user,
          text: 'Another question',
          timestamp: now.add(const Duration(seconds: 5)),
        ),
        TranscriptEntry(
          id: 'seg-3',
          role: TranscriptRole.agent,
          text: 'Second response',
          timestamp: now.add(const Duration(seconds: 10)),
        ),
      ];

      final artifacts = [
        const ArtifactEvent(
          artifactType: ArtifactType.diff,
          title: 'change-1',
          messageId: 'seg-1',
        ),
        const ArtifactEvent(
          artifactType: ArtifactType.code,
          title: 'code-1',
          messageId: 'seg-1',
        ),
        const ArtifactEvent(
          artifactType: ArtifactType.diff,
          title: 'change-2',
          messageId: 'seg-3',
        ),
      ];

      final result = groupArtifactsByMessage(artifacts, transcript);

      // seg-1 gets 2 artifacts, seg-3 gets 1
      expect(result['seg-1']?.length, 2);
      expect(result['seg-1']?[0].title, 'change-1');
      expect(result['seg-1']?[1].title, 'code-1');
      expect(result['seg-3']?.length, 1);
      expect(result['seg-3']?[0].title, 'change-2');
      // seg-2 (user message) has no artifacts
      expect(result['seg-2'], isNull);
    });

    test('artifacts without messageId fall back to last agent message', () {
      final transcript = [
        TranscriptEntry(
          id: 'seg-1',
          role: TranscriptRole.agent,
          text: 'First response',
          timestamp: now,
        ),
        TranscriptEntry(
          id: 'seg-2',
          role: TranscriptRole.agent,
          text: 'Second response',
          timestamp: now.add(const Duration(seconds: 5)),
        ),
      ];

      const artifacts = [
        ArtifactEvent(
          artifactType: ArtifactType.code,
          title: 'orphan-artifact',
          // no messageId
        ),
      ];

      final result = groupArtifactsByMessage(artifacts, transcript);

      // Falls back to last agent message (seg-2)
      expect(result['seg-2']?.length, 1);
      expect(result['seg-2']?[0].title, 'orphan-artifact');
      expect(result['seg-1'], isNull);
    });

    test('mixed: stamped artifacts go to their message, unstamped to last agent',
        () {
      final transcript = [
        TranscriptEntry(
          id: 'seg-1',
          role: TranscriptRole.agent,
          text: 'First',
          timestamp: now,
        ),
        TranscriptEntry(
          id: 'seg-2',
          role: TranscriptRole.agent,
          text: 'Second',
          timestamp: now.add(const Duration(seconds: 5)),
        ),
      ];

      const artifacts = [
        ArtifactEvent(
          artifactType: ArtifactType.diff,
          title: 'stamped',
          messageId: 'seg-1',
        ),
        ArtifactEvent(
          artifactType: ArtifactType.code,
          title: 'unstamped',
          // no messageId - should fall back to seg-2
        ),
      ];

      final result = groupArtifactsByMessage(artifacts, transcript);

      expect(result['seg-1']?.length, 1);
      expect(result['seg-1']?[0].title, 'stamped');
      expect(result['seg-2']?.length, 1);
      expect(result['seg-2']?[0].title, 'unstamped');
    });

    test('no agent messages: artifacts with no messageId are not grouped', () {
      final transcript = [
        TranscriptEntry(
          id: 'seg-1',
          role: TranscriptRole.user,
          text: 'Hello',
          timestamp: now,
        ),
      ];

      const artifacts = [
        ArtifactEvent(
          artifactType: ArtifactType.code,
          title: 'orphan',
          // no messageId and no agent messages
        ),
      ];

      final result = groupArtifactsByMessage(artifacts, transcript);
      // No agent message to attach to
      expect(result, isEmpty);
    });

    test('artifacts maintain insertion order within a message group', () {
      final transcript = [
        TranscriptEntry(
          id: 'seg-1',
          role: TranscriptRole.agent,
          text: 'Response',
          timestamp: now,
        ),
      ];

      const artifacts = [
        ArtifactEvent(
          artifactType: ArtifactType.diff,
          title: 'first',
          messageId: 'seg-1',
        ),
        ArtifactEvent(
          artifactType: ArtifactType.code,
          title: 'second',
          messageId: 'seg-1',
        ),
        ArtifactEvent(
          artifactType: ArtifactType.file,
          title: 'third',
          messageId: 'seg-1',
        ),
      ];

      final result = groupArtifactsByMessage(artifacts, transcript);

      expect(result['seg-1']?.length, 3);
      expect(result['seg-1']?[0].title, 'first');
      expect(result['seg-1']?[1].title, 'second');
      expect(result['seg-1']?[2].title, 'third');
    });

    test('total artifacts count is preserved regardless of grouping', () {
      final transcript = [
        TranscriptEntry(
          id: 'seg-1',
          role: TranscriptRole.agent,
          text: 'First',
          timestamp: now,
        ),
        TranscriptEntry(
          id: 'seg-2',
          role: TranscriptRole.agent,
          text: 'Second',
          timestamp: now.add(const Duration(seconds: 5)),
        ),
      ];

      const artifacts = [
        ArtifactEvent(
          artifactType: ArtifactType.diff,
          title: 'a1',
          messageId: 'seg-1',
        ),
        ArtifactEvent(
          artifactType: ArtifactType.code,
          title: 'a2',
          messageId: 'seg-1',
        ),
        ArtifactEvent(
          artifactType: ArtifactType.diff,
          title: 'a3',
          messageId: 'seg-2',
        ),
        ArtifactEvent(
          artifactType: ArtifactType.code,
          title: 'a4',
          // no messageId -- falls to seg-2
        ),
      ];

      // Total count for status bar
      expect(artifacts.length, 4);

      final result = groupArtifactsByMessage(artifacts, transcript);
      final totalGrouped =
          result.values.fold<int>(0, (sum, list) => sum + list.length);
      expect(totalGrouped, 4);
    });
  });
}
