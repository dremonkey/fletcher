import 'dart:math';
import 'package:flutter/material.dart';

import '../theme/app_colors.dart';
import '../theme/app_typography.dart';

/// Tappable agent histogram that toggles TTS on/off.
///
/// When TTS is enabled, shows amber agent histogram bars.
/// When disabled, shows "TTS OFF" text. Single-tap toggles between states.
class TtsToggle extends StatelessWidget {
  final bool voiceOutEnabled;
  final List<double> agentAmplitudes;
  final VoidCallback onToggle;

  const TtsToggle({
    super.key,
    required this.voiceOutEnabled,
    required this.agentAmplitudes,
    required this.onToggle,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onToggle,
      child: voiceOutEnabled
          ? RepaintBoundary(
              child: CustomPaint(
                painter: _AgentHistogramPainter(
                  amplitudes: agentAmplitudes,
                  color: AppColors.amber,
                ),
                child: const SizedBox.expand(),
              ),
            )
          : SizedBox(
              height: 48,
              child: Align(
                alignment: Alignment.centerLeft,
                child: Container(
                  width: _AgentHistogramPainter.totalWidth,
                  height: 36,
                  decoration: BoxDecoration(
                    border: Border.all(
                      color: AppColors.textSecondary.withAlpha(77),
                    ),
                  ),
                  alignment: Alignment.center,
                  child: Text(
                    'TTS OFF',
                    style: AppTypography.label.copyWith(
                      color: AppColors.textSecondary,
                      letterSpacing: 2,
                    ),
                  ),
                ),
              ),
            ),
    );
  }
}

/// Paints agent histogram bars left-to-right within available width.
class _AgentHistogramPainter extends CustomPainter {
  final List<double> amplitudes;
  final Color color;

  static const int _barCount = 15;
  static const double _barWidth = 3.75;
  static const double _gapBetweenBars = 2.5;
  static const double _minBarHeight = 2.0;
  static const int _quantizeLevels = 8;
  static const double totalWidth =
      _barCount * _barWidth + (_barCount - 1) * _gapBetweenBars;

  _AgentHistogramPainter({
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

    // Draw bars left-to-right from left edge (mirrors user side)
    for (int i = 0; i < _barCount; i++) {
      final barHeight = _quantize(samples[i], size.height);
      final x = i * (_barWidth + _gapBetweenBars).toDouble();
      final y = (size.height - barHeight) / 2;

      canvas.drawRect(
        Rect.fromLTWH(x, y, _barWidth, barHeight),
        paint,
      );
    }
  }

  @override
  bool shouldRepaint(covariant _AgentHistogramPainter oldDelegate) {
    return oldDelegate.amplitudes != amplitudes;
  }
}
