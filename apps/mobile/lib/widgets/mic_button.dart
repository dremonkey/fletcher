import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../models/conversation_state.dart';
import '../theme/app_colors.dart';

/// 56dp square mic button replacing the AmberOrb as the primary interaction.
///
/// Visual states:
/// - Idle/Listening: static amber mic icon with subtle breathing glow
/// - Thinking/processing: spinning arc overlay
/// - Speaking (aiSpeaking): pulse synced to aiAudioLevel
/// - Muted: dimmed mic_off icon
/// - Error/Reconnecting: colored border (red/yellow)
/// - Connecting: dimmed, 0.5 opacity
class MicButton extends StatefulWidget {
  final ConversationStatus status;
  final double aiAudioLevel;
  final bool isMuted;
  final VoidCallback onToggleMute;

  /// Called when the user long-presses the mic button (~500ms).
  /// Used to toggle text-input mode.
  final VoidCallback? onLongPress;

  const MicButton({
    super.key,
    required this.status,
    required this.aiAudioLevel,
    required this.isMuted,
    required this.onToggleMute,
    this.onLongPress,
  });

  @override
  State<MicButton> createState() => _MicButtonState();
}

class _MicButtonState extends State<MicButton> with TickerProviderStateMixin {
  late AnimationController _breathingController;
  late Animation<double> _breathingAnimation;
  late AnimationController _spinController;

  @override
  void initState() {
    super.initState();

    // Breathing glow animation (500ms period as specified)
    _breathingController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 500),
    )..repeat(reverse: true);

    _breathingAnimation = Tween<double>(
      begin: 0.15,
      end: 0.35,
    ).animate(CurvedAnimation(
      parent: _breathingController,
      curve: Curves.easeInOut,
    ));

    // Spin animation for processing state (1200ms rotation)
    _spinController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1200),
    );
  }

  @override
  void didUpdateWidget(MicButton oldWidget) {
    super.didUpdateWidget(oldWidget);

    if (widget.status == ConversationStatus.processing) {
      if (!_spinController.isAnimating) {
        _spinController.repeat();
      }
    } else {
      if (_spinController.isAnimating) {
        _spinController.stop();
        _spinController.reset();
      }
    }
  }

  @override
  void dispose() {
    _breathingController.dispose();
    _spinController.dispose();
    super.dispose();
  }

  String get _stateName {
    if (widget.isMuted) return 'muted';
    switch (widget.status) {
      case ConversationStatus.idle:
        return 'listening';
      case ConversationStatus.userSpeaking:
        return 'listening';
      case ConversationStatus.processing:
        return 'processing';
      case ConversationStatus.aiSpeaking:
        return 'agent speaking';
      case ConversationStatus.connecting:
        return 'connecting';
      case ConversationStatus.reconnecting:
        return 'reconnecting';
      case ConversationStatus.error:
        return 'error';
      case ConversationStatus.muted:
        return 'muted';
    }
  }

  Color get _borderColor {
    if (widget.status == ConversationStatus.error) {
      return AppColors.healthRed;
    }
    if (widget.status == ConversationStatus.reconnecting) {
      return AppColors.healthYellow;
    }
    return AppColors.amber;
  }

  double get _opacity {
    if (widget.status == ConversationStatus.connecting) return 0.5;
    if (widget.isMuted) return 1.0;
    return 1.0;
  }

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'Microphone, currently $_stateName. Double tap to toggle mute',
      child: AnimatedBuilder(
        animation: Listenable.merge([_breathingAnimation, _spinController]),
        builder: (context, child) {
          return Opacity(
            opacity: _opacity,
            child: GestureDetector(
              onTap: () {
                HapticFeedback.mediumImpact();
                widget.onToggleMute();
              },
              onLongPress: widget.onLongPress != null
                  ? () {
                      HapticFeedback.heavyImpact();
                      widget.onLongPress!();
                    }
                  : null,
              child: SizedBox(
                width: 56,
                height: 56,
                child: Stack(
                  alignment: Alignment.center,
                  children: [
                    // Breathing glow (idle/listening only)
                    if (!widget.isMuted &&
                        (widget.status == ConversationStatus.idle ||
                            widget.status == ConversationStatus.userSpeaking))
                      Container(
                        width: 56,
                        height: 56,
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.zero,
                          boxShadow: [
                            BoxShadow(
                              color: AppColors.amber
                                  .withAlpha((_breathingAnimation.value * 255).toInt()),
                              blurRadius: 12,
                              spreadRadius: 2,
                            ),
                          ],
                        ),
                      ),
                    // AI speaking pulse glow
                    if (widget.status == ConversationStatus.aiSpeaking)
                      Container(
                        width: 56,
                        height: 56,
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.zero,
                          boxShadow: [
                            BoxShadow(
                              color: AppColors.amber
                                  .withAlpha((widget.aiAudioLevel.clamp(0.0, 1.0) * 200).toInt()),
                              blurRadius: 16,
                              spreadRadius: 4,
                            ),
                          ],
                        ),
                      ),
                    // Main button container
                    Container(
                      width: 56,
                      height: 56,
                      decoration: BoxDecoration(
                        color: AppColors.surface,
                        borderRadius: BorderRadius.zero,
                        border: Border.all(
                          color: _borderColor,
                          width: 1.5,
                        ),
                      ),
                      child: Icon(
                        widget.isMuted
                            ? Icons.mic_off_rounded
                            : Icons.mic_rounded,
                        color: widget.isMuted
                            ? AppColors.amber.withAlpha(97) // 0.38 * 255
                            : AppColors.amber,
                        size: 28,
                      ),
                    ),
                    // Spinning arc overlay for processing
                    if (widget.status == ConversationStatus.processing)
                      SizedBox(
                        width: 56,
                        height: 56,
                        child: CustomPaint(
                          painter: _SpinArcPainter(
                            progress: _spinController.value,
                            color: AppColors.amber,
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

/// Paints a spinning sweep gradient arc overlay on the mic button.
class _SpinArcPainter extends CustomPainter {
  final double progress;
  final Color color;

  _SpinArcPainter({required this.progress, required this.color});

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Rect.fromLTWH(0, 0, size.width, size.height);
    final gradient = SweepGradient(
      colors: [
        color.withAlpha(0),
        color.withAlpha(89), // ~0.35 opacity
        color.withAlpha(0),
      ],
      stops: const [0.0, 0.25, 0.5],
      transform: GradientRotation(progress * 2 * math.pi),
    );
    final paint = Paint()
      ..shader = gradient.createShader(rect)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2;

    canvas.drawRect(rect, paint);
  }

  @override
  bool shouldRepaint(covariant _SpinArcPainter oldDelegate) {
    return oldDelegate.progress != progress;
  }
}
