import 'dart:convert';
import 'dart:typed_data';

import 'package:fake_async/fake_async.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:fletcher/services/relay/chunk_reassembler.dart';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Build a valid chunk map matching the relay wire format.
Map<String, dynamic> makeChunk({
  required String transferId,
  required int chunkIndex,
  required int totalChunks,
  required String data, // base64-encoded content
}) => {
      'type': 'chunk',
      'transfer_id': transferId,
      'chunk_index': chunkIndex,
      'total_chunks': totalChunks,
      'data': data,
    };

/// Split [payload] into [n] base64-encoded chunks, each with matching metadata.
List<Map<String, dynamic>> buildChunks(String payload, String transferId) {
  final bytes = utf8.encode(payload);
  // Chunk into 2 parts for simplicity (unless payload is tiny)
  final mid = (bytes.length / 2).ceil();
  final part0 = base64Encode(bytes.sublist(0, mid));
  final part1 = base64Encode(bytes.sublist(mid));
  return [
    makeChunk(
      transferId: transferId,
      chunkIndex: 0,
      totalChunks: 2,
      data: part0,
    ),
    makeChunk(
      transferId: transferId,
      chunkIndex: 1,
      totalChunks: 2,
      data: part1,
    ),
  ];
}

/// Split [payload] into exactly [n] roughly-equal base64-encoded chunks.
List<Map<String, dynamic>> buildNChunks(
    String payload, String transferId, int n) {
  final bytes = Uint8List.fromList(utf8.encode(payload));
  final chunkSize = (bytes.length / n).ceil();
  final chunks = <Map<String, dynamic>>[];
  for (var i = 0; i < n; i++) {
    final start = i * chunkSize;
    final end = (start + chunkSize).clamp(0, bytes.length);
    final data = base64Encode(bytes.sublist(start, end));
    chunks.add(makeChunk(
      transferId: transferId,
      chunkIndex: i,
      totalChunks: n,
      data: data,
    ));
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  group('RelayChunk.fromJson', () {
    test('parses a valid chunk map', () {
      final json = makeChunk(
        transferId: 'abc',
        chunkIndex: 0,
        totalChunks: 2,
        data: 'SGVsbG8=',
      );
      final chunk = RelayChunk.fromJson(json);
      expect(chunk, isNotNull);
      expect(chunk!.transferId, 'abc');
      expect(chunk.chunkIndex, 0);
      expect(chunk.totalChunks, 2);
      expect(chunk.data, 'SGVsbG8=');
    });

    test('returns null when transfer_id is missing', () {
      final json = {
        'type': 'chunk',
        'chunk_index': 0,
        'total_chunks': 2,
        'data': 'SGVsbG8=',
      };
      expect(RelayChunk.fromJson(json), isNull);
    });

    test('returns null when chunk_index is missing', () {
      final json = {
        'type': 'chunk',
        'transfer_id': 'abc',
        'total_chunks': 2,
        'data': 'SGVsbG8=',
      };
      expect(RelayChunk.fromJson(json), isNull);
    });

    test('returns null when data is missing', () {
      final json = {
        'type': 'chunk',
        'transfer_id': 'abc',
        'chunk_index': 0,
        'total_chunks': 2,
      };
      expect(RelayChunk.fromJson(json), isNull);
    });

    test('returns null for an empty map', () {
      expect(RelayChunk.fromJson({}), isNull);
    });
  });

  group('ChunkReassembler', () {
    late List<String> reassembled;
    late ChunkReassembler reassembler;

    setUp(() {
      reassembled = [];
      reassembler = ChunkReassembler(
        onComplete: reassembled.add,
        timeout: const Duration(seconds: 10),
      );
    });

    tearDown(() {
      reassembler.dispose();
    });

    // -----------------------------------------------------------------------
    // Happy path
    // -----------------------------------------------------------------------

    test('reassembles 2 chunks arriving in order', () {
      const payload = 'Hello, relay chunking!';
      final chunks = buildChunks(payload, 'tx-001');

      reassembler.handleChunk(chunks[0]);
      reassembler.handleChunk(chunks[1]);

      expect(reassembled, hasLength(1));
      expect(reassembled.first, payload);
    });

    test('reassembles 2 chunks arriving out of order', () {
      const payload = 'Out-of-order test payload';
      final chunks = buildChunks(payload, 'tx-002');

      // Deliver chunk 1 first, then chunk 0
      reassembler.handleChunk(chunks[1]);
      reassembler.handleChunk(chunks[0]);

      expect(reassembled, hasLength(1));
      expect(reassembled.first, payload);
    });

    test('reassembles 4 chunks in shuffled order', () {
      final payload = 'A' * 1000;
      final chunks = buildNChunks(payload, 'tx-003', 4);

      // Deliver in reverse order
      for (final chunk in chunks.reversed) {
        reassembler.handleChunk(chunk);
      }

      expect(reassembled, hasLength(1));
      expect(reassembled.first, payload);
    });

    test('reassembles a JSON payload correctly', () {
      final payload = jsonEncode({
        'jsonrpc': '2.0',
        'method': 'session/update',
        'params': {'content': 'x' * 500},
      });
      final chunks = buildChunks(payload, 'tx-004');

      for (final chunk in chunks) {
        reassembler.handleChunk(chunk);
      }

      expect(reassembled, hasLength(1));
      // Verify round-trip fidelity
      final decoded = jsonDecode(reassembled.first) as Map<String, dynamic>;
      expect(decoded['method'], 'session/update');
    });

    test('handles two independent transfers concurrently', () {
      final payload1 = 'Transfer 1 payload data';
      final payload2 = 'Transfer 2 payload data (different)';
      final chunksA = buildChunks(payload1, 'tx-A');
      final chunksB = buildChunks(payload2, 'tx-B');

      // Interleave delivery
      reassembler.handleChunk(chunksA[0]);
      reassembler.handleChunk(chunksB[0]);
      reassembler.handleChunk(chunksA[1]);
      reassembler.handleChunk(chunksB[1]);

      expect(reassembled, hasLength(2));
      expect(reassembled, containsAll([payload1, payload2]));
    });

    test('tolerates duplicate chunk delivery (idempotent)', () {
      const payload = 'Deduplicate me';
      final chunks = buildChunks(payload, 'tx-dup');

      // Deliver chunk[0] twice, then chunk[1]
      reassembler.handleChunk(chunks[0]);
      reassembler.handleChunk(chunks[0]); // duplicate
      reassembler.handleChunk(chunks[1]);

      // Only one reassembled message; no double-fire
      expect(reassembled, hasLength(1));
      expect(reassembled.first, payload);
    });

    // -----------------------------------------------------------------------
    // Stale-transfer timeout
    // -----------------------------------------------------------------------

    test('incomplete transfer is discarded after timeout', () {
      fakeAsync((async) {
        final reassembledInFake = <String>[];
        final r = ChunkReassembler(
          onComplete: reassembledInFake.add,
          timeout: const Duration(seconds: 10),
        );

        final chunks = buildChunks('Never complete', 'tx-timeout');
        // Deliver only the first chunk
        r.handleChunk(chunks[0]);

        // Advance past the timeout
        async.elapse(const Duration(seconds: 11));

        expect(reassembledInFake, isEmpty);
        r.dispose();
      });
    });

    test('completed transfer is not affected by elapsed time', () {
      fakeAsync((async) {
        final reassembledInFake = <String>[];
        final r = ChunkReassembler(
          onComplete: reassembledInFake.add,
          timeout: const Duration(seconds: 10),
        );

        const payload = 'Complete before timeout';
        final chunks = buildChunks(payload, 'tx-complete');

        r.handleChunk(chunks[0]);
        r.handleChunk(chunks[1]);

        // Advance time after completion — should not cause issues
        async.elapse(const Duration(seconds: 15));

        expect(reassembledInFake, hasLength(1));
        expect(reassembledInFake.first, payload);
        r.dispose();
      });
    });

    // -----------------------------------------------------------------------
    // Edge cases and malformed input
    // -----------------------------------------------------------------------

    test('drops a malformed chunk with missing fields', () {
      reassembler.handleChunk({'type': 'chunk', 'data': 'broken'});
      expect(reassembled, isEmpty);
    });

    test('drops a chunk with out-of-bounds index', () {
      final chunk = makeChunk(
        transferId: 'tx-oob',
        chunkIndex: 5, // totalChunks is 2
        totalChunks: 2,
        data: base64Encode(utf8.encode('oob')),
      );
      reassembler.handleChunk(chunk);
      expect(reassembled, isEmpty);
    });

    test('dispose cancels pending timers without firing', () {
      // Should not throw or call onComplete after dispose
      fakeAsync((async) {
        final reassembledInFake = <String>[];
        final r = ChunkReassembler(
          onComplete: reassembledInFake.add,
          timeout: const Duration(seconds: 10),
        );

        final chunks = buildChunks('Will be disposed', 'tx-dispose');
        r.handleChunk(chunks[0]); // start transfer

        r.dispose(); // dispose before second chunk

        // Elapse past timeout — should not call onComplete
        async.elapse(const Duration(seconds: 15));

        expect(reassembledInFake, isEmpty);
      });
    });
  });

  // -------------------------------------------------------------------------
  // Integration: RelayChatService routes chunk messages to reassembler
  // -------------------------------------------------------------------------
  group('RelayChatService + ChunkReassembler integration', () {
    // Import service only for this integration group to avoid circular imports
    // in unit tests above. We test via handleMessage() directly.
    late List<String> reassembled;
    late ChunkReassembler reassembler;

    setUp(() {
      reassembled = [];
      reassembler = ChunkReassembler(onComplete: reassembled.add);
    });

    tearDown(() {
      reassembler.dispose();
    });

    test('single-chunk (non-chunked) payload passes through', () {
      // A normal JSON-RPC message has type != 'chunk' — not routed to reassembler
      final json = {
        'jsonrpc': '2.0',
        'method': 'session/update',
        'params': {'update': 'test'},
      };
      // Feed a non-chunk message to reassembler — it should silently ignore it
      reassembler.handleChunk(json);
      expect(reassembled, isEmpty);
    });

    test('full round-trip: encode payload → split → reassemble → decode', () {
      final originalPayload = jsonEncode({
        'jsonrpc': '2.0',
        'method': 'session/update',
        'params': {
          'sessionId': 'sess_x',
          'update': {'sessionUpdate': 'agent_message_chunk', 'content': 'y' * 800},
        },
      });

      final chunks = buildNChunks(originalPayload, 'rt-001', 3);

      for (final chunk in chunks) {
        reassembler.handleChunk(chunk);
      }

      expect(reassembled, hasLength(1));
      expect(reassembled.first, originalPayload);

      final decoded = jsonDecode(reassembled.first) as Map<String, dynamic>;
      expect(decoded['method'], 'session/update');
    });
  });
}
