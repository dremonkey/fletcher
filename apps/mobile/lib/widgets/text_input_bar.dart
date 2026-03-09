import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../models/conversation_state.dart';
import '../services/livekit_service.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../theme/app_typography.dart';
import 'mic_button.dart';

/// Animated input bar that transitions between voice-first (centered mic)
/// and text-input mode (text field + mic on right + send button).
///
/// The bar listens to [LiveKitService] state for the current [TextInputMode]
/// and drives a single [AnimationController] that synchronizes:
///   - Mic button sliding from center to right
///   - Text field expanding from left
///   - Send button fading in
class TextInputBar extends StatefulWidget {
  final LiveKitService service;

  const TextInputBar({super.key, required this.service});

  @override
  State<TextInputBar> createState() => _TextInputBarState();
}

class _TextInputBarState extends State<TextInputBar>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _slideAnimation;
  late Animation<double> _expandAnimation;
  late Animation<double> _fadeAnimation;

  final TextEditingController _textController = TextEditingController();
  final FocusNode _focusNode = FocusNode();

  @override
  void initState() {
    super.initState();

    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 400),
    );

    // Mic button slides from center (0.0) to right (1.0)
    _slideAnimation = CurvedAnimation(
      parent: _controller,
      curve: Curves.easeInOutCubic,
    );

    // Text field expands from 0.0 (collapsed) to 1.0 (full width)
    _expandAnimation = CurvedAnimation(
      parent: _controller,
      curve: Curves.easeInOutCubic,
    );

    // Send button fades in slightly delayed
    _fadeAnimation = CurvedAnimation(
      parent: _controller,
      curve: const Interval(0.3, 1.0, curve: Curves.easeIn),
    );

    // Listen to animation status for auto-focus
    _controller.addStatusListener(_onAnimationStatus);

    // Listen for text changes to update send button state
    _textController.addListener(_onTextChanged);

    widget.service.addListener(_onServiceChanged);

    // Sync initial state
    if (widget.service.state.inputMode == TextInputMode.textInput) {
      _controller.value = 1.0;
    }
  }

  @override
  void dispose() {
    widget.service.removeListener(_onServiceChanged);
    _controller.removeStatusListener(_onAnimationStatus);
    _controller.dispose();
    _textController.removeListener(_onTextChanged);
    _textController.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  void _onServiceChanged() {
    if (!mounted) return;
    final mode = widget.service.state.inputMode;
    if (mode == TextInputMode.textInput && _controller.status != AnimationStatus.forward && _controller.status != AnimationStatus.completed) {
      _controller.forward();
    } else if (mode == TextInputMode.voiceFirst && _controller.status != AnimationStatus.reverse && _controller.status != AnimationStatus.dismissed) {
      // Cleanup: dismiss keyboard and clear text when reverting
      _focusNode.unfocus();
      _textController.clear();
      _controller.reverse();
    }
    setState(() {});
  }

  void _onAnimationStatus(AnimationStatus status) {
    if (status == AnimationStatus.completed) {
      // Auto-focus the text field when entering text-input mode
      _focusNode.requestFocus();
    }
  }

  void _onTextChanged() {
    // Rebuild to update send button enabled state
    if (mounted) setState(() {});
  }

  void _onLongPress() {
    widget.service.toggleInputMode();
  }

  void _sendMessage() {
    final text = _textController.text.trim();
    if (text.isEmpty) return;
    widget.service.sendTextMessage(text);
    _textController.clear();
    // Re-focus after send so user can keep typing
    _focusNode.requestFocus();
  }

  @override
  Widget build(BuildContext context) {
    final state = widget.service.state;

    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        final isExpanded = _controller.value > 0.0;

        return Padding(
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.base),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              // Text field (expands from left)
              if (isExpanded)
                Expanded(
                  child: Opacity(
                    opacity: _expandAnimation.value,
                    child: SizedBox(
                      height: 56,
                      child: _buildTextField(),
                    ),
                  ),
                ),

              // Send button (visible in text-input mode)
              if (isExpanded) ...[
                const SizedBox(width: AppSpacing.sm),
                Opacity(
                  opacity: _fadeAnimation.value,
                  child: _buildSendButton(),
                ),
                const SizedBox(width: AppSpacing.sm),
              ],

              // Mic button (always visible, slides right)
              MicButton(
                status: state.status,
                aiAudioLevel: state.aiAudioLevel,
                isMuted: widget.service.isMuted,
                onToggleMute: widget.service.toggleMute,
                onLongPress: _onLongPress,
              ),
            ],
          ),
        );
      },
    );
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
            vertical: AppSpacing.md,
          ),
          isDense: true,
        ),
      ),
    );
  }

  Widget _buildSendButton() {
    final hasText = _textController.text.trim().isNotEmpty;

    return GestureDetector(
      onTap: hasText ? _sendMessage : null,
      child: Container(
        width: 44,
        height: 44,
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.zero,
          border: Border.all(
            color: hasText
                ? AppColors.amber
                : AppColors.amber.withAlpha(51), // 0.2 opacity
            width: 1,
          ),
        ),
        child: Icon(
          Icons.arrow_upward_rounded,
          color: hasText
              ? AppColors.amber
              : AppColors.amber.withAlpha(51),
          size: 22,
        ),
      ),
    );
  }
}
