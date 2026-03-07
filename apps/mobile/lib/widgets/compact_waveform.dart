import 'dart:math';
import 'package:flutter/material.dart';

import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';

/// Full-width compact waveform bar showing user (amber) and agent (cyan) audio.
///
/// Uses an 8-bit histogram style with discrete stepped bars and sharp corners
/// (no rounded edges). Left portion shows user waveform, right portion shows
/// agent waveform, with a small gap between them.
class CompactWaveform extends StatelessWidget {
  final List<double> userAmplitudes;
  final List<double> agentAmplitudes;

  const CompactWaveform({
    super.key,
    required this.userAmplitudes,
    required this.agentAmplitudes,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 48,
      width: double.infinity,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.base),
        child: RepaintBoundary(
          child: CustomPaint(
            painter: _CompactWaveformPainter(
              userAmplitudes: userAmplitudes,
              agentAmplitudes: agentAmplitudes,
              userColor: AppColors.amber,
              agentColor: AppColors.cyan,
            ),
          ),
        ),
      ),
    );
  }
}

class _CompactWaveformPainter extends CustomPainter {
  final List<double> userAmplitudes;
  final List<double> agentAmplitudes;
  final Color userColor;
  final Color agentColor;

  static const int _barCount = 15;
  static const double _barWidth = 3.0;
  static const double _gapBetweenBars = 2.0;
  static const double _centerGap = 8.0;
  static const double _minBarHeight = 2.0;

  /// Number of discrete height levels for the 8-bit stepped look.
  static const int _quantizeLevels = 8;

  _CompactWaveformPainter({
    required this.userAmplitudes,
    required this.agentAmplitudes,
    required this.userColor,
    required this.agentColor,
  });

  List<double> _getSamples(List<double> amplitudes) {
    if (amplitudes.length >= _barCount) {
      return amplitudes.sublist(amplitudes.length - _barCount);
    }
    return List<double>.filled(_barCount - amplitudes.length, 0.0) + amplitudes;
  }

  /// Quantize amplitude to discrete steps for the 8-bit look.
  double _quantize(double value, double maxHeight) {
    final step = maxHeight / _quantizeLevels;
    final raw = value.clamp(0.0, 1.0) * maxHeight;
    final quantized = (raw / step).ceil() * step;
    return max(_minBarHeight, quantized);
  }

  void _drawBars(
    Canvas canvas,
    List<double> samples,
    Color color,
    double startX,
    double height,
    bool rightToLeft,
  ) {
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.fill;

    for (int i = 0; i < _barCount; i++) {
      final amplitude = samples[i];
      final barHeight = _quantize(amplitude, height);

      double x;
      if (rightToLeft) {
        x = startX - (i * (_barWidth + _gapBetweenBars)) - _barWidth;
      } else {
        x = startX + i * (_barWidth + _gapBetweenBars);
      }

      final y = (height - barHeight) / 2;

      // Sharp corners -- no Radius.circular
      canvas.drawRect(
        Rect.fromLTWH(x, y, _barWidth, barHeight),
        paint,
      );
    }
  }

  @override
  void paint(Canvas canvas, Size size) {
    final centerX = size.width / 2;
    final userSamples = _getSamples(userAmplitudes);
    final agentSamples = _getSamples(agentAmplitudes);

    // User bars: right-to-left from center (left half)
    _drawBars(
      canvas,
      userSamples,
      userColor,
      centerX - (_centerGap / 2),
      size.height,
      true,
    );

    // Agent bars: left-to-right from center (right half)
    _drawBars(
      canvas,
      agentSamples,
      agentColor,
      centerX + (_centerGap / 2),
      size.height,
      false,
    );
  }

  @override
  bool shouldRepaint(covariant _CompactWaveformPainter oldDelegate) {
    return oldDelegate.userAmplitudes != userAmplitudes ||
        oldDelegate.agentAmplitudes != agentAmplitudes;
  }
}
