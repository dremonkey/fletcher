import 'package:flutter/material.dart';

import '../models/conversation_state.dart';
import '../services/livekit_service.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../theme/app_typography.dart';
import 'mic_button.dart';

/// Animated input bar that transitions between voice-first (centered mic)
/// and text-input mode (text field + mic on right).
///
/// Tap the mic button to mute and reveal the text field; tap again to unmute
/// and hide it (keyboard is dismissed automatically).
///
/// Submit via the keyboard's carriage return (TextInputAction.send).
class TextInputBar extends StatefulWidget {
  final LiveKitService service;

  const TextInputBar({super.key, required this.service});

  @override
  State<TextInputBar> createState() => _TextInputBarState();
}

class _TextInputBarState extends State<TextInputBar>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _expandAnimation;

  final TextEditingController _textController = TextEditingController();
  final FocusNode _focusNode = FocusNode();

  @override
  void initState() {
    super.initState();

    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 400),
    );

    // Text field expands from 0.0 (collapsed) to 1.0 (full width)
    _expandAnimation = CurvedAnimation(
      parent: _controller,
      curve: Curves.easeInOutCubic,
    );

    // Listen to animation status for auto-focus
    _controller.addStatusListener(_onAnimationStatus);

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
    // No auto-focus — the user taps the text field to open the keyboard.
  }

  void _onTapMic() {
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

              if (isExpanded)
                const SizedBox(width: AppSpacing.sm),

              // Mic button (always visible, slides right)
              MicButton(
                status: state.status,
                aiAudioLevel: state.aiAudioLevel,
                isMuted: widget.service.isMuted,
                onToggleMute: _onTapMic,
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
