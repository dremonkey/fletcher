import 'dart:math';
import 'package:flutter/material.dart';

/// Renders a waveform visualization from a rolling buffer of audio levels.
class AudioWaveform extends StatelessWidget {
  final List<double> amplitudes;
  final Color color;
  final double height;
  final int barCount;

  const AudioWaveform({
    super.key,
    required this.amplitudes,
    this.color = const Color(0xFFF59E0B),
    this.height = 40,
    this.barCount = 15,
  });

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      size: Size(barCount * 6.0, height),
      painter: _WaveformPainter(
        amplitudes: amplitudes,
        color: color,
        barCount: barCount,
      ),
    );
  }
}

class _WaveformPainter extends CustomPainter {
  final List<double> amplitudes;
  final Color color;
  final int barCount;

  _WaveformPainter({
    required this.amplitudes,
    required this.color,
    required this.barCount,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.fill;

    final barWidth = 3.0;
    final gap = (size.width - barWidth * barCount) / max(barCount - 1, 1);
    final minBarHeight = 2.0;

    // Take the last barCount samples from the buffer
    final samples = amplitudes.length >= barCount
        ? amplitudes.sublist(amplitudes.length - barCount)
        : List<double>.filled(barCount - amplitudes.length, 0.0) + amplitudes;

    for (int i = 0; i < barCount; i++) {
      final amplitude = samples[i].clamp(0.0, 1.0);
      final barHeight = max(minBarHeight, amplitude * size.height);
      final x = i * (barWidth + gap);
      final y = (size.height - barHeight) / 2;

      final rect = RRect.fromRectAndRadius(
        Rect.fromLTWH(x, y, barWidth, barHeight),
        const Radius.circular(1.5),
      );
      canvas.drawRRect(rect, paint);
    }
  }

  @override
  bool shouldRepaint(covariant _WaveformPainter oldDelegate) {
    return oldDelegate.amplitudes != amplitudes ||
        oldDelegate.color != color;
  }
}
