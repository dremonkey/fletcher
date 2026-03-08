import 'dart:math';

import 'package:flutter/material.dart';

import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../theme/app_typography.dart';
import '../theme/tui_widgets.dart';

/// Inline animated spinner shown in the chat transcript while the agent is
/// "thinking" (between user finishing speaking and first agent text arriving).
///
/// Displays a multi-phase ASCII "shooting arrow" animation:
/// 1. **Notch:** Arrow `███▶` appears at the left margin.
/// 2. **Streak:** Arrow travels character-by-character across the line.
/// 3. **Impact:** Arrow shatters into ASCII particles at the right margin.
/// 4. **Rebirth:** Particles dissipate, then the loop repeats.
///
/// Wrapped in a [TuiCard] with amber left border to match agent messages.
/// Uses monospace amber text, sharp corners, no header.
class ThinkingSpinner extends StatefulWidget {
  const ThinkingSpinner({super.key});

  @override
  State<ThinkingSpinner> createState() => _ThinkingSpinnerState();
}

/// The arrow glyph used during Notch and Streak phases.
const String _arrowGlyph = '▪▪▪▶';

/// Characters used for impact/explosion particles.
const List<String> _particleChars = ['▪', '·', '∙', '°', '▫'];

/// Animation phase enum for the shooting arrow.
enum ArrowPhase {
  /// Arrow appears at left margin.
  notch,

  /// Arrow travels across the line.
  streak,

  /// Arrow explodes into particles at the right margin.
  impact,

  /// Particles fade out before repeating.
  rebirth,
}

/// Duration constants for each phase.
class _PhaseDurations {
  static const notch = Duration(milliseconds: 400);
  static const streakPerChar = Duration(milliseconds: 35);
  static const impact = Duration(milliseconds: 500);
  static const rebirth = Duration(milliseconds: 400);
}

class _ThinkingSpinnerState extends State<ThinkingSpinner>
    with TickerProviderStateMixin {
  ArrowPhase _phase = ArrowPhase.notch;

  /// Current character position of the arrow's leading tip during streak.
  int _arrowPosition = 0;

  /// Total character width available for the animation.
  int _lineWidth = 0;

  /// Controls the notch fade-in and impact/rebirth timing.
  late AnimationController _phaseController;

  /// Controls the streak — ticks once per character step.
  late AnimationController _streakController;

  /// Random source for particle generation.
  final Random _rng = Random();

  /// Particle positions and characters, generated at impact.
  List<_Particle> _particles = [];

  @override
  void initState() {
    super.initState();

    _phaseController = AnimationController(
      vsync: this,
      duration: _PhaseDurations.notch,
    );

    _streakController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1000), // placeholder, reset later
    );

    _startNotch();
  }

  @override
  void dispose() {
    _phaseController.dispose();
    _streakController.dispose();
    super.dispose();
  }

  // ---------------------------------------------------------------------------
  // Phase transitions
  // ---------------------------------------------------------------------------

  void _startNotch() {
    _phase = ArrowPhase.notch;
    _arrowPosition = 0;
    _particles = [];

    _phaseController.duration = _PhaseDurations.notch;
    _phaseController.forward(from: 0).then((_) {
      if (mounted) _startStreak();
    });
  }

  void _startStreak() {
    if (_lineWidth <= _arrowGlyph.length) {
      // Not enough room — skip straight to impact.
      if (mounted) _startImpact();
      return;
    }

    _phase = ArrowPhase.streak;
    _arrowPosition = 0;

    // Total positions the arrow must travel: from position 0 to the rightmost
    // position where the arrow tip touches the margin.
    final totalSteps = _lineWidth - _arrowGlyph.length;
    final streakDuration = _PhaseDurations.streakPerChar * totalSteps;

    _streakController.duration =
        streakDuration < const Duration(milliseconds: 100)
            ? const Duration(milliseconds: 100)
            : streakDuration;

    _streakController.removeStatusListener(_onStreakStatus);
    _streakController.addStatusListener(_onStreakStatus);
    _streakController.addListener(_onStreakTick);
    _streakController.forward(from: 0);
  }

  void _onStreakTick() {
    if (!mounted) return;
    if (_lineWidth <= _arrowGlyph.length) return;

    final totalSteps = _lineWidth - _arrowGlyph.length;
    final newPos =
        (_streakController.value * totalSteps).floor().clamp(0, totalSteps);

    if (newPos != _arrowPosition) {
      setState(() {
        _arrowPosition = newPos;
      });
    }
  }

  void _onStreakStatus(AnimationStatus status) {
    if (status == AnimationStatus.completed) {
      _streakController.removeStatusListener(_onStreakStatus);
      _streakController.removeListener(_onStreakTick);
      if (mounted) _startImpact();
    }
  }

  void _startImpact() {
    _phase = ArrowPhase.impact;
    _generateParticles();

    _phaseController.duration = _PhaseDurations.impact;
    _phaseController.forward(from: 0).then((_) {
      if (mounted) _startRebirth();
    });
    setState(() {});
  }

  void _startRebirth() {
    _phase = ArrowPhase.rebirth;

    _phaseController.duration = _PhaseDurations.rebirth;
    _phaseController.forward(from: 0).then((_) {
      if (mounted) _startNotch();
    });
    setState(() {});
  }

  // ---------------------------------------------------------------------------
  // Particle generation
  // ---------------------------------------------------------------------------

  void _generateParticles() {
    // Spawn particles near the right margin where the arrow hit.
    final count = 8 + _rng.nextInt(5); // 8-12 particles
    final impactCol = _lineWidth > 0 ? _lineWidth - 1 : 0;
    _particles = List.generate(count, (_) {
      // Particles scatter left from the impact point.
      final offset = _rng.nextInt(min(12, max(1, _lineWidth)));
      final col = max(0, impactCol - offset);
      final ch = _particleChars[_rng.nextInt(_particleChars.length)];
      return _Particle(column: col, char: ch);
    });
  }

  // ---------------------------------------------------------------------------
  // Build
  // ---------------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    return RepaintBoundary(
      child: TuiCard(
        borderColor: AppColors.amber,
        child: Padding(
          padding: const EdgeInsets.only(left: AppSpacing.sm),
          child: LayoutBuilder(
            builder: (context, constraints) {
              // Estimate character width from the monospace body style.
              final charWidth = _measureCharWidth(context);
              final availableWidth =
                  constraints.maxWidth - AppSpacing.sm; // padding offset
              final cols = charWidth > 0
                  ? (availableWidth / charWidth).floor()
                  : 40; // fallback

              if (cols != _lineWidth && cols > 0) {
                // Schedule a post-frame update so we don't setState during build.
                WidgetsBinding.instance.addPostFrameCallback((_) {
                  if (mounted && _lineWidth != cols) {
                    _lineWidth = cols;
                  }
                });
                // Use the new value immediately for this build.
                _lineWidth = cols;
              }

              return AnimatedBuilder(
                animation: _phaseController,
                builder: (context, _) {
                  return _buildLine();
                },
              );
            },
          ),
        ),
      ),
    );
  }

  Widget _buildLine() {
    final String text;
    double opacity = 1.0;

    switch (_phase) {
      case ArrowPhase.notch:
        // Arrow fades in at position 0.
        opacity = _phaseController.value;
        text = _renderArrowAt(0);
      case ArrowPhase.streak:
        text = _renderArrowAt(_arrowPosition);
      case ArrowPhase.impact:
        // Particles with gradual fade.
        opacity = 1.0;
        text = _renderParticles();
      case ArrowPhase.rebirth:
        // Particles fading out.
        opacity = 1.0 - _phaseController.value;
        text = _renderParticles();
    }

    return Opacity(
      opacity: opacity.clamp(0.0, 1.0),
      child: Text(
        text,
        style: AppTypography.body.copyWith(
          color: AppColors.amber,
        ),
        maxLines: 1,
        overflow: TextOverflow.clip,
      ),
    );
  }

  /// Render the arrow glyph padded to [position] within the line.
  String _renderArrowAt(int position) {
    if (_lineWidth <= 0) return _arrowGlyph;
    final int pad =
        position.clamp(0, max(0, _lineWidth - _arrowGlyph.length)).toInt();
    final line = ' ' * pad + _arrowGlyph;
    // Pad to full width so the Text widget keeps a consistent size.
    return line.padRight(_lineWidth);
  }

  /// Render explosion particles as a sparse character line.
  String _renderParticles() {
    if (_lineWidth <= 0) return '';
    final buffer = List.filled(_lineWidth, ' ');
    for (final p in _particles) {
      if (p.column >= 0 && p.column < _lineWidth) {
        buffer[p.column] = p.char;
      }
    }
    return buffer.join();
  }

  /// Measure the width of a single monospace character using the body style.
  double _measureCharWidth(BuildContext context) {
    final tp = TextPainter(
      text: TextSpan(
        text: 'M',
        style: AppTypography.body.copyWith(color: AppColors.amber),
      ),
      textDirection: TextDirection.ltr,
      maxLines: 1,
    )..layout();
    return tp.size.width;
  }
}

/// A single particle in the impact/rebirth explosion.
class _Particle {
  final int column;
  final String char;

  const _Particle({required this.column, required this.char});
}
