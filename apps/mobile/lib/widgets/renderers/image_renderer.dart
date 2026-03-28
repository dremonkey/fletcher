import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../../models/content_block.dart';
import '../renderer_registry.dart';

// ---------------------------------------------------------------------------
// ImageTooLargeException
// ---------------------------------------------------------------------------

class ImageTooLargeException implements Exception {
  final int bytes;

  const ImageTooLargeException(this.bytes);

  double get megabytes => bytes / (1024 * 1024);

  @override
  String toString() =>
      'ImageTooLargeException: ${megabytes.toStringAsFixed(1)} MB '
      '(limit $_limitMb MB)';
}

// ---------------------------------------------------------------------------
// ImageRenderer
// ---------------------------------------------------------------------------

class ImageRenderer extends StatefulWidget {
  final ImageContent block;

  const ImageRenderer({super.key, required this.block});

  @override
  State<ImageRenderer> createState() => _ImageRendererState();
}

class _ImageRendererState extends State<ImageRenderer> {
  _DecodeState _state = const _Loading();

  @override
  void initState() {
    super.initState();
    _startDecode();
  }

  @override
  void didUpdateWidget(ImageRenderer old) {
    super.didUpdateWidget(old);
    if (old.block.data != widget.block.data) {
      setState(() => _state = const _Loading());
      _startDecode();
    }
  }

  Future<void> _startDecode() async {
    try {
      final bytes = await compute(_decodeBase64, widget.block.data);
      if (!mounted) return;
      setState(() => _state = _Ready(bytes));
    } on ImageTooLargeException catch (e) {
      if (!mounted) return;
      setState(() => _state = _Oversized(e.megabytes));
    } catch (e) {
      if (!mounted) return;
      setState(() => _state = _Failed(e.toString()));
    }
  }

  @override
  Widget build(BuildContext context) {
    return switch (_state) {
      _Loading() => const Center(
          child: Padding(
            padding: EdgeInsets.all(24),
            child: CircularProgressIndicator(),
          ),
        ),
      _Ready(bytes: final bytes) => Image.memory(
          bytes,
          fit: BoxFit.contain,
          errorBuilder: (_, error, __) => _ErrorView(
            message: 'Could not display image: $error',
          ),
        ),
      _Oversized(megabytes: final mb) => _ErrorView(
          message:
              'Image too large (${mb.toStringAsFixed(1)} MB, limit $_limitMb MB)',
        ),
      _Failed(message: final msg) => _ErrorView(message: msg),
    };
  }
}

// ---------------------------------------------------------------------------
// Isolate decode function (top-level, required by compute)
// ---------------------------------------------------------------------------

const int _limitMb = 5;

Uint8List _decodeBase64(String data) {
  final bytes = base64Decode(data);
  if (bytes.length > 5 * 1024 * 1024) {
    throw ImageTooLargeException(bytes.length);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// State variants
// ---------------------------------------------------------------------------

sealed class _DecodeState {
  const _DecodeState();
}

class _Loading extends _DecodeState {
  const _Loading();
}

class _Ready extends _DecodeState {
  final Uint8List bytes;
  const _Ready(this.bytes);
}

class _Oversized extends _DecodeState {
  final double megabytes;
  const _Oversized(this.megabytes);
}

class _Failed extends _DecodeState {
  final String message;
  const _Failed(this.message);
}

// ---------------------------------------------------------------------------
// Error view helper
// ---------------------------------------------------------------------------

class _ErrorView extends StatelessWidget {
  final String message;

  const _ErrorView({required this.message});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        border: Border.all(color: Colors.red.shade300),
        borderRadius: BorderRadius.circular(4),
        color: Colors.red.shade50,
      ),
      child: Row(
        children: [
          const Icon(Icons.broken_image, color: Colors.red),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message,
              style: const TextStyle(color: Colors.red),
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Registry registration
// ---------------------------------------------------------------------------

/// Register ImageRenderer for all image/* MIME types.
///
/// Call this BEFORE [bootstrapRendererRegistry] so it takes priority over
/// the placeholder registration.
void registerImageRenderer(RendererRegistry registry) {
  registry.register(
    'image/*',
    (block) => ImageRenderer(block: block as ImageContent),
  );
}
