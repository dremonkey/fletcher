import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';

// ---------------------------------------------------------------------------
// Chunk message model
// ---------------------------------------------------------------------------

/// A single chunk received from the relay data channel.
class RelayChunk {
  final String transferId;
  final int chunkIndex;
  final int totalChunks;
  final String data; // base64-encoded slice

  const RelayChunk({
    required this.transferId,
    required this.chunkIndex,
    required this.totalChunks,
    required this.data,
  });

  /// Parse from a raw JSON map. Returns null if required fields are missing
  /// or have unexpected types.
  static RelayChunk? fromJson(Map<String, dynamic> json) {
    try {
      final transferId = json['transfer_id'] as String?;
      final chunkIndex = json['chunk_index'] as int?;
      final totalChunks = json['total_chunks'] as int?;
      final data = json['data'] as String?;

      if (transferId == null ||
          chunkIndex == null ||
          totalChunks == null ||
          data == null) {
        return null;
      }

      return RelayChunk(
        transferId: transferId,
        chunkIndex: chunkIndex,
        totalChunks: totalChunks,
        data: data,
      );
    } catch (_) {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// ChunkReassembler
// ---------------------------------------------------------------------------

/// Buffers relay data-channel chunks and reassembles them into complete
/// JSON payloads.
///
/// Usage:
/// ```dart
/// final reassembler = ChunkReassembler(
///   onComplete: (payload) => handleAcpMessage(jsonDecode(payload)),
/// );
///
/// // In your data-channel handler:
/// if (msg['type'] == 'chunk') {
///   reassembler.handleChunk(msg);
/// }
/// ```
///
/// Stale transfers (incomplete after [timeout]) are discarded to prevent
/// memory leaks from dropped packets.
class ChunkReassembler {
  /// Called with the reassembled JSON string when all chunks arrive.
  final void Function(String payload) onComplete;

  /// How long to wait for the remaining chunks before discarding. Default 10s.
  final Duration timeout;

  // transferId → sparse list of base64 chunks (null = not yet received)
  final Map<String, List<String?>> _buffers = {};

  // transferId → cleanup timer
  final Map<String, Timer> _timers = {};

  ChunkReassembler({
    required this.onComplete,
    this.timeout = const Duration(seconds: 10),
  });

  /// Feed a raw JSON map for a chunk message. Ignores invalid or malformed
  /// chunks. Reassembles and fires [onComplete] when all chunks arrive.
  void handleChunk(Map<String, dynamic> json) {
    final chunk = RelayChunk.fromJson(json);
    if (chunk == null) {
      debugPrint('[ChunkReassembler] Dropped malformed chunk: $json');
      return;
    }

    final id = chunk.transferId;

    // Validate index bounds
    if (chunk.chunkIndex < 0 || chunk.chunkIndex >= chunk.totalChunks) {
      debugPrint('[ChunkReassembler] Chunk index out of bounds: '
          '${chunk.chunkIndex}/${chunk.totalChunks} for transfer $id');
      return;
    }

    // Initialize buffer and start stale-transfer timer on first chunk
    if (!_buffers.containsKey(id)) {
      _buffers[id] = List<String?>.filled(chunk.totalChunks, null);
      _timers[id] = Timer(timeout, () => _expireTransfer(id));
    }

    final buffer = _buffers[id]!;

    // Tolerate duplicate delivery — just overwrite
    buffer[chunk.chunkIndex] = chunk.data;

    // Check if all chunks have arrived
    if (buffer.every((c) => c != null)) {
      _timers[id]?.cancel();
      _timers.remove(id);
      _buffers.remove(id);
      _reassemble(id, buffer.cast<String>());
    }
  }

  /// Release all buffers and cancel all pending timers.
  void dispose() {
    for (final timer in _timers.values) {
      timer.cancel();
    }
    _timers.clear();
    _buffers.clear();
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  void _reassemble(String transferId, List<String> parts) {
    try {
      // Decode each base64 slice and concatenate the raw bytes
      final allBytes = <int>[];
      for (final part in parts) {
        allBytes.addAll(base64Decode(part));
      }

      final payload = utf8.decode(Uint8List.fromList(allBytes));
      debugPrint('[ChunkReassembler] Reassembled transfer $transferId '
          '(${allBytes.length} bytes)');
      onComplete(payload);
    } catch (e) {
      debugPrint('[ChunkReassembler] Failed to reassemble transfer '
          '$transferId: $e');
    }
  }

  void _expireTransfer(String transferId) {
    final buffer = _buffers.remove(transferId);
    _timers.remove(transferId);

    if (buffer == null) return;

    final received = buffer.where((c) => c != null).length;
    final total = buffer.length;
    debugPrint('[ChunkReassembler] Transfer $transferId timed out — '
        'received $received/$total chunks; discarding');
  }
}
