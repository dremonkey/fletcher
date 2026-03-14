import 'dart:math';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../models/conversation_state.dart';
import '../services/livekit_service.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../theme/app_typography.dart';
import 'mic_button.dart';

/// Unified bottom bar: mic button with animated histograms (voice mode) or
/// text field (text input mode).
///
/// Voice mode active: `[user histogram] [mic] [agent histogram]`
/// Text input mode:   `[text field] [mic]`
/// Default (neither):  `[mic centered]`
class VoiceControlBar extends StatefulWidget {
  final LiveKitService service;

  const VoiceControlBar({super.key, required this.service});

  @override
  State<VoiceControlBar> createState() => _VoiceControlBarState();
}

class _VoiceControlBarState extends State<VoiceControlBar>
    with TickerProviderStateMixin {
  // Text field expansion (existing behavior from TextInputBar)
  late AnimationController _textFieldController;
  late Animation<double> _textFieldAnimation;

  // Histogram reveal — user (left of mic)
  late AnimationController _userHistoController;
  late Animation<double> _userHistoAnimation;

  // Histogram reveal — agent (right of mic, 50ms stagger)
  late AnimationController _agentHistoController;
  late Animation<double> _agentHistoAnimation;

  final TextEditingController _textController = TextEditingController();
  final FocusNode _focusNode = FocusNode();

  // Track target state to avoid redundant animation triggers
  bool _histogramsTargetVisible = false;
  bool _textFieldTargetVisible = false;

  @override
  void initState() {
    super.initState();

    // Text field: 400ms easeInOutCubic (matches original TextInputBar)
    _textFieldController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 400),
    );
    _textFieldAnimation = CurvedAnimation(
      parent: _textFieldController,
      curve: Curves.easeInOutCubic,
    );

    // User histogram: 300ms easeOutCubic
    _userHistoController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 300),
    );
    _userHistoAnimation = CurvedAnimation(
      parent: _userHistoController,
      curve: Curves.easeOutCubic,
    );

    // Agent histogram: 300ms easeOutCubic (starts 50ms after user)
    _agentHistoController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 300),
    );
    _agentHistoAnimation = CurvedAnimation(
      parent: _agentHistoController,
      curve: Curves.easeOutCubic,
    );

    widget.service.addListener(_onServiceChanged);
    _syncAnimations(animate: false);
  }

  @override
  void dispose() {
    widget.service.removeListener(_onServiceChanged);
    _textFieldController.dispose();
    _userHistoController.dispose();
    _agentHistoController.dispose();
    _textController.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  void _onServiceChanged() {
    if (!mounted) return;
    _syncAnimations(animate: true);
    setState(() {});
  }

  void _syncAnimations({required bool animate}) {
    final wantText =
        widget.service.state.inputMode == TextInputMode.textInput;
    final wantHistograms = widget.service.isVoiceModeActive;

    // Text field — delay expansion if histograms are still shrinking
    if (wantText != _textFieldTargetVisible) {
      _textFieldTargetVisible = wantText;
      if (wantText) {
        if (animate) {
          final delay = _userHistoController.value > 0.1
              ? const Duration(milliseconds: 150)
              : Duration.zero;
          Future.delayed(delay, () {
            if (mounted && _textFieldTargetVisible) {
              _textFieldController.forward();
            }
          });
        } else {
          _textFieldController.value = 1.0;
        }
      } else {
        _focusNode.unfocus();
        _textController.clear();
        animate
            ? _textFieldController.reverse()
            : _textFieldController.value = 0.0;
      }
    }

    // Histograms — delay reveal if text field is still shrinking
    if (wantHistograms != _histogramsTargetVisible) {
      _histogramsTargetVisible = wantHistograms;
      if (wantHistograms) {
        if (animate) {
          final delay = _textFieldController.value > 0.1
              ? const Duration(milliseconds: 200)
              : Duration.zero;
          Future.delayed(delay, () {
            if (mounted && _histogramsTargetVisible) {
              _userHistoController.forward();
              Future.delayed(const Duration(milliseconds: 50), () {
                if (mounted) _agentHistoController.forward();
              });
            }
          });
        } else {
          _userHistoController.value = 1.0;
          _agentHistoController.value = 1.0;
        }
      } else {
        if (animate) {
          _userHistoController.reverse();
          _agentHistoController.reverse();
        } else {
          _userHistoController.value = 0.0;
          _agentHistoController.value = 0.0;
        }
      }
    }
  }

  void _onTapMic() {
    widget.service.toggleInputMode();
  }

  void _onTapUserHistogram() {
    HapticFeedback.lightImpact();
    widget.service.muteOnly();
  }

  void _onTapAgentHistogram() {
    HapticFeedback.lightImpact();
    widget.service.toggleTextOnlyMode();
  }

  void _sendMessage() {
    final text = _textController.text.trim();
    if (text.isEmpty) return;
    widget.service.sendTextMessage(text);
    _textController.clear();
    _focusNode.requestFocus();
  }

  @override
  Widget build(BuildContext context) {
    final state = widget.service.state;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.base),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final availableWidth = constraints.maxWidth;
          const micWidth = 56.0;
          const textGap = AppSpacing.sm; // 8dp
          final textFieldWidth = availableWidth - micWidth - textGap;

          return AnimatedBuilder(
            animation: Listenable.merge([
              _textFieldController,
              _userHistoController,
              _agentHistoController,
            ]),
            builder: (context, child) {
              final isMutedInVoice =
                  widget.service.isMuted && widget.service.isVoiceModeActive;

              return Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  // --- Text field (text input mode) ---
                  SizeTransition(
                    axis: Axis.horizontal,
                    sizeFactor: _textFieldAnimation,
                    axisAlignment: 1.0,
                    child: FadeTransition(
                      opacity: _textFieldAnimation,
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          SizedBox(
                            width: textFieldWidth,
                            height: 56,
                            child: _buildTextField(),
                          ),
                          const SizedBox(width: textGap),
                        ],
                      ),
                    ),
                  ),

                  // --- User histogram (voice mode, left of mic) ---
                  SizeTransition(
                    axis: Axis.horizontal,
                    sizeFactor: _userHistoAnimation,
                    axisAlignment: 1.0, // grow from right edge (toward mic)
                    child: FadeTransition(
                      opacity: _userHistoAnimation,
                      child: GestureDetector(
                        onTap: _onTapUserHistogram,
                        behavior: HitTestBehavior.opaque,
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            AnimatedOpacity(
                              opacity: isMutedInVoice ? 0.3 : 1.0,
                              duration: const Duration(milliseconds: 200),
                              child: SizedBox(
                                width: _HistogramPainter.totalWidth,
                                height: 56,
                                child: RepaintBoundary(
                                  child: CustomPaint(
                                    painter: _HistogramPainter(
                                      amplitudes: state.userWaveform,
                                      color: AppColors.cyan,
                                      direction:
                                          _HistogramDirection.rightToLeft,
                                    ),
                                  ),
                                ),
                              ),
                            ),
                            const SizedBox(width: AppSpacing.md),
                          ],
                        ),
                      ),
                    ),
                  ),

                  // --- Mic button (always visible) ---
                  MicButton(
                    status: state.status,
                    aiAudioLevel: state.aiAudioLevel,
                    isMuted: widget.service.isMuted,
                    onToggleMute: _onTapMic,
                  ),

                  // --- Agent histogram (voice mode, right of mic) ---
                  SizeTransition(
                    axis: Axis.horizontal,
                    sizeFactor: _agentHistoAnimation,
                    axisAlignment: -1.0, // grow from left edge (toward mic)
                    child: FadeTransition(
                      opacity: _agentHistoAnimation,
                      child: GestureDetector(
                        onTap: _onTapAgentHistogram,
                        behavior: HitTestBehavior.opaque,
                        child: _buildAgentHistogramArea(state),
                      ),
                    ),
                  ),
                ],
              );
            },
          );
        },
      ),
    );
  }

  Widget _buildAgentHistogramArea(ConversationState state) {
    if (widget.service.voiceOutEnabled) {
      return Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const SizedBox(width: AppSpacing.md),
          SizedBox(
            width: _HistogramPainter.totalWidth,
            height: 56,
            child: RepaintBoundary(
              child: CustomPaint(
                painter: _HistogramPainter(
                  amplitudes: state.aiWaveform,
                  color: AppColors.amber,
                  direction: _HistogramDirection.leftToRight,
                ),
              ),
            ),
          ),
        ],
      );
    } else {
      return Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const SizedBox(width: AppSpacing.md),
          Container(
            width: _HistogramPainter.totalWidth,
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
        ],
      );
    }
  }

  Widget _buildTextField() {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.zero,
        border: Border.all(
          color: AppColors.amber.withAlpha(102), // 0.4 opacity
          width: 1,
        ),
      ),
      child: TextField(
        controller: _textController,
        focusNode: _focusNode,
        style: AppTypography.body,
        textInputAction: TextInputAction.send,
        onSubmitted: (_) => _sendMessage(),
        cursorColor: AppColors.amber,
        decoration: InputDecoration(
          hintText: 'Type a message...',
          hintStyle: AppTypography.body.copyWith(
            color: AppColors.textSecondary.withAlpha(128),
          ),
          border: InputBorder.none,
          contentPadding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.md,
          ),
          isCollapsed: true,
        ),
        expands: true,
        maxLines: null,
        minLines: null,
        textAlignVertical: TextAlignVertical.center,
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Histogram painter — unified for both user and agent sides
// ---------------------------------------------------------------------------

enum _HistogramDirection { leftToRight, rightToLeft }

/// Paints quantized histogram bars with configurable direction.
///
/// Samples are reversed so newest data appears closest to the mic button
/// (right edge for user/rightToLeft, left edge for agent/leftToRight).
class _HistogramPainter extends CustomPainter {
  final List<double> amplitudes;
  final Color color;
  final _HistogramDirection direction;

  static const int _barCount = 15;
  static const double _barWidth = 3.75;
  static const double _gapBetweenBars = 2.5;
  static const double _minBarHeight = 2.0;
  static const int _quantizeLevels = 8;
  static const double totalWidth =
      _barCount * _barWidth + (_barCount - 1) * _gapBetweenBars;

  _HistogramPainter({
    required this.amplitudes,
    required this.color,
    required this.direction,
  });

  List<double> _getSamples() {
    List<double> raw;
    if (amplitudes.length >= _barCount) {
      raw = amplitudes.sublist(amplitudes.length - _barCount);
    } else {
      raw = List<double>.filled(_barCount - amplitudes.length, 0.0) +
          amplitudes;
    }
    // Reverse: newest sample (end of buffer) drawn closest to mic
    return raw.reversed.toList();
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

    for (int i = 0; i < _barCount; i++) {
      final barHeight = _quantize(samples[i], size.height);
      final double x;
      if (direction == _HistogramDirection.rightToLeft) {
        x = size.width - (i * (_barWidth + _gapBetweenBars)) - _barWidth;
      } else {
        x = i * (_barWidth + _gapBetweenBars);
      }
      final y = (size.height - barHeight) / 2;
      canvas.drawRect(Rect.fromLTWH(x, y, _barWidth, barHeight), paint);
    }
  }

  @override
  bool shouldRepaint(covariant _HistogramPainter oldDelegate) {
    return oldDelegate.amplitudes != amplitudes ||
        oldDelegate.direction != direction;
  }
}
