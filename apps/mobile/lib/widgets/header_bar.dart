import 'dart:math';
import 'package:flutter/material.dart';

import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import 'tts_toggle.dart';

/// Split header bar: user histogram (left) + TTS toggle (right).
///
/// 48dp height, full width. Left side shows the user's voice-in histogram,
/// right side shows the interactive TTS toggle (text or agent histogram).
class HeaderBar extends StatelessWidget {
  final List<double> userAmplitudes;
  final List<double> agentAmplitudes;
  final bool voiceOutEnabled;
  final VoidCallback onToggleTts;

  const HeaderBar({
    super.key,
    required this.userAmplitudes,
    required this.agentAmplitudes,
    required this.voiceOutEnabled,
    required this.onToggleTts,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 48,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.base),
        child: Row(
          children: [
            // Left: User voice-in histogram
            Expanded(
              child: RepaintBoundary(
                child: CustomPaint(
                  painter: _UserHistogramPainter(
                    amplitudes: userAmplitudes,
                    color: AppColors.cyan,
                  ),
                  child: const SizedBox.expand(),
                ),
              ),
            ),
            const SizedBox(width: AppSpacing.sm),
            // Right: TTS toggle
            Expanded(
              child: TtsToggle(
                voiceOutEnabled: voiceOutEnabled,
                agentAmplitudes: agentAmplitudes,
                onToggle: onToggleTts,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Paints user histogram bars right-to-left (anchored to right edge).
class _UserHistogramPainter extends CustomPainter {
  final List<double> amplitudes;
  final Color color;

  static const int _barCount = 15;
  static const double _barWidth = 3.75;
  static const double _gapBetweenBars = 2.5;
  static const double _minBarHeight = 2.0;
  static const int _quantizeLevels = 8;

  _UserHistogramPainter({
    required this.amplitudes,
    required this.color,
  });

  List<double> _getSamples() {
    if (amplitudes.length >= _barCount) {
      return amplitudes.sublist(amplitudes.length - _barCount);
    }
    return List<double>.filled(_barCount - amplitudes.length, 0.0) + amplitudes;
  }

  double _quantize(double value, double maxHeight) {
    final step = maxHeight / _quantizeLevels;
    final raw = value.clamp(0.0, 1.0) * maxHeight;
    final quantized = (raw / step).ceil() * step;
    return max(_minBarHeight, quantized);
  }

  @override
  void paint(Canvas canvas, Size size) {
    if (size.height == 0 || size.width == 0) return;

    final samples = _getSamples();
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.fill;

    // Draw bars right-to-left from right edge
    final startX = size.width;

    for (int i = 0; i < _barCount; i++) {
      final barHeight = _quantize(samples[i], size.height);
      final x = startX - (i * (_barWidth + _gapBetweenBars)) - _barWidth;
      final y = (size.height - barHeight) / 2;

      canvas.drawRect(
        Rect.fromLTWH(x, y, _barWidth, barHeight),
        paint,
      );
    }
  }

  @override
  bool shouldRepaint(covariant _UserHistogramPainter oldDelegate) {
    return oldDelegate.amplitudes != amplitudes;
  }
}
