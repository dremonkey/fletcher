import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../models/conversation_state.dart';

class AmberOrb extends StatefulWidget {
  final ConversationStatus status;
  final double userAudioLevel;
  final double aiAudioLevel;

  const AmberOrb({
    super.key,
    required this.status,
    this.userAudioLevel = 0.0,
    this.aiAudioLevel = 0.0,
  });

  @override
  State<AmberOrb> createState() => _AmberOrbState();
}

class _AmberOrbState extends State<AmberOrb> with TickerProviderStateMixin {
  late AnimationController _breathingController;
  late AnimationController _pulseController;
  late Animation<double> _breathingAnimation;
  late Animation<double> _pulseAnimation;

  // Ripple state
  final List<_Ripple> _ripples = [];

  @override
  void initState() {
    super.initState();

    // Breathing animation (idle state)
    _breathingController = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 4),
    )..repeat(reverse: true);

    _breathingAnimation = Tween<double>(
      begin: 1.0,
      end: 1.02,
    ).animate(CurvedAnimation(
      parent: _breathingController,
      curve: Curves.easeInOut,
    ));

    // Pulse animation (AI speaking)
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 150),
    );

    _pulseAnimation = Tween<double>(
      begin: 1.0,
      end: 1.15,
    ).animate(CurvedAnimation(
      parent: _pulseController,
      curve: Curves.easeOut,
    ));
  }

  @override
  void didUpdateWidget(AmberOrb oldWidget) {
    super.didUpdateWidget(oldWidget);

    // Trigger ripples when user is speaking
    if (widget.status == ConversationStatus.userSpeaking &&
        widget.userAudioLevel > 0.1) {
      _addRipple();
    }

    // Control pulse for AI speaking
    if (widget.status == ConversationStatus.aiSpeaking) {
      final targetScale = 1.0 + (widget.aiAudioLevel * 0.15);
      _pulseController.animateTo(
        (targetScale - 1.0) / 0.15,
        duration: const Duration(milliseconds: 100),
      );
    } else {
      _pulseController.animateTo(0);
    }
  }

  void _addRipple() {
    if (_ripples.length >= 3) return;

    final controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1000),
    );

    final ripple = _Ripple(
      controller: controller,
      animation: Tween<double>(begin: 0.0, end: 1.0).animate(
        CurvedAnimation(parent: controller, curve: Curves.easeOut),
      ),
    );

    setState(() => _ripples.add(ripple));

    controller.forward().then((_) {
      controller.dispose();
      if (mounted) {
        setState(() => _ripples.remove(ripple));
      }
    });
  }

  @override
  void dispose() {
    _breathingController.dispose();
    _pulseController.dispose();
    for (final ripple in _ripples) {
      ripple.controller.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: Listenable.merge([
        _breathingAnimation,
        _pulseAnimation,
        ..._ripples.map((r) => r.animation),
      ]),
      builder: (context, child) {
        double scale = _breathingAnimation.value;

        // Apply pulse scale for AI speaking
        if (widget.status == ConversationStatus.aiSpeaking) {
          scale = _pulseAnimation.value;
        }

        // Dim for muted/error states
        double opacity = 1.0;
        Color orbColor = const Color(0xFFF59E0B); // Amber

        switch (widget.status) {
          case ConversationStatus.connecting:
            opacity = 0.5;
            break;
          case ConversationStatus.muted:
            opacity = 0.3;
            break;
          case ConversationStatus.error:
            orbColor = const Color(0xFFEF4444); // Red
            opacity = 0.7;
            break;
          case ConversationStatus.userSpeaking:
            orbColor = const Color(0xFFFCD34D); // Bright amber
            break;
          default:
            break;
        }

        return SizedBox(
          width: 200,
          height: 200,
          child: Stack(
            alignment: Alignment.center,
            children: [
              // Ripples (user speaking)
              ..._ripples.map((ripple) => _buildRipple(ripple, orbColor)),

              // Outer glow
              Transform.scale(
                scale: scale,
                child: Container(
                  width: 160,
                  height: 160,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    boxShadow: [
                      BoxShadow(
                        color: orbColor.withOpacity(0.4 * opacity),
                        blurRadius: 40,
                        spreadRadius: 10,
                      ),
                    ],
                  ),
                ),
              ),

              // Main orb
              Transform.scale(
                scale: scale,
                child: Container(
                  width: 120,
                  height: 120,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    gradient: RadialGradient(
                      colors: [
                        orbColor.withOpacity(opacity),
                        orbColor.withOpacity(0.8 * opacity),
                        orbColor.withOpacity(0.6 * opacity),
                      ],
                      stops: const [0.0, 0.5, 1.0],
                    ),
                    boxShadow: [
                      BoxShadow(
                        color: orbColor.withOpacity(0.6 * opacity),
                        blurRadius: 20,
                        spreadRadius: 5,
                      ),
                    ],
                  ),
                ),
              ),

              // Processing shimmer overlay
              if (widget.status == ConversationStatus.processing)
                _buildShimmer(orbColor, scale),
            ],
          ),
        );
      },
    );
  }

  Widget _buildRipple(_Ripple ripple, Color color) {
    final progress = ripple.animation.value;
    final size = 120 + (80 * progress);
    final opacity = (1.0 - progress) * 0.5;

    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        border: Border.all(
          color: color.withOpacity(opacity),
          width: 2,
        ),
      ),
    );
  }

  Widget _buildShimmer(Color color, double scale) {
    return Transform.scale(
      scale: scale,
      child: Container(
        width: 120,
        height: 120,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          gradient: SweepGradient(
            colors: [
              color.withOpacity(0.0),
              color.withOpacity(0.3),
              color.withOpacity(0.0),
            ],
            transform: GradientRotation(
              _breathingController.value * 2 * math.pi,
            ),
          ),
        ),
      ),
    );
  }
}

class _Ripple {
  final AnimationController controller;
  final Animation<double> animation;

  _Ripple({required this.controller, required this.animation});
}
