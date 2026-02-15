import 'package:flutter/material.dart';
import '../models/conversation_state.dart';

/// Displays the current agent status (what the agent is doing).
/// Shows actions like "Reading file...", "Searching...", etc.
class StatusBar extends StatelessWidget {
  final StatusEvent? status;

  const StatusBar({
    super.key,
    this.status,
  });

  @override
  Widget build(BuildContext context) {
    if (status == null) {
      return const SizedBox.shrink();
    }

    return AnimatedOpacity(
      opacity: status != null ? 1.0 : 0.0,
      duration: const Duration(milliseconds: 200),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        decoration: BoxDecoration(
          color: const Color(0xFF1F1F1F),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: _getStatusColor(status!.action).withOpacity(0.3),
          ),
          boxShadow: [
            BoxShadow(
              color: _getStatusColor(status!.action).withOpacity(0.1),
              blurRadius: 8,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            _StatusIcon(action: status!.action),
            const SizedBox(width: 10),
            Flexible(
              child: Text(
                status!.displayText,
                style: TextStyle(
                  color: _getStatusColor(status!.action),
                  fontSize: 13,
                  fontWeight: FontWeight.w500,
                ),
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Color _getStatusColor(StatusAction action) {
    switch (action) {
      case StatusAction.thinking:
        return const Color(0xFFF59E0B); // Amber
      case StatusAction.searchingFiles:
        return const Color(0xFF3B82F6); // Blue
      case StatusAction.readingFile:
        return const Color(0xFF10B981); // Green
      case StatusAction.writingFile:
      case StatusAction.editingFile:
        return const Color(0xFFF97316); // Orange
      case StatusAction.webSearch:
        return const Color(0xFF8B5CF6); // Purple
      case StatusAction.executingCommand:
        return const Color(0xFFEF4444); // Red
      case StatusAction.analyzing:
        return const Color(0xFF06B6D4); // Cyan
    }
  }
}

/// Animated icon for status actions
class _StatusIcon extends StatefulWidget {
  final StatusAction action;

  const _StatusIcon({required this.action});

  @override
  State<_StatusIcon> createState() => _StatusIconState();
}

class _StatusIconState extends State<_StatusIcon>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      duration: const Duration(milliseconds: 1000),
      vsync: this,
    )..repeat();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return RotationTransition(
      turns: _shouldSpin ? _controller : const AlwaysStoppedAnimation(0),
      child: Icon(
        _getIcon(),
        size: 16,
        color: _getColor(),
      ),
    );
  }

  bool get _shouldSpin {
    return widget.action == StatusAction.thinking ||
        widget.action == StatusAction.analyzing ||
        widget.action == StatusAction.searchingFiles;
  }

  IconData _getIcon() {
    switch (widget.action) {
      case StatusAction.thinking:
        return Icons.psychology_outlined;
      case StatusAction.searchingFiles:
        return Icons.search_rounded;
      case StatusAction.readingFile:
        return Icons.description_outlined;
      case StatusAction.writingFile:
        return Icons.edit_note_rounded;
      case StatusAction.editingFile:
        return Icons.edit_rounded;
      case StatusAction.webSearch:
        return Icons.language_rounded;
      case StatusAction.executingCommand:
        return Icons.terminal_rounded;
      case StatusAction.analyzing:
        return Icons.analytics_outlined;
    }
  }

  Color _getColor() {
    switch (widget.action) {
      case StatusAction.thinking:
        return const Color(0xFFF59E0B);
      case StatusAction.searchingFiles:
        return const Color(0xFF3B82F6);
      case StatusAction.readingFile:
        return const Color(0xFF10B981);
      case StatusAction.writingFile:
      case StatusAction.editingFile:
        return const Color(0xFFF97316);
      case StatusAction.webSearch:
        return const Color(0xFF8B5CF6);
      case StatusAction.executingCommand:
        return const Color(0xFFEF4444);
      case StatusAction.analyzing:
        return const Color(0xFF06B6D4);
    }
  }
}
