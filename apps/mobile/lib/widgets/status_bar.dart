import 'package:flutter/material.dart';
import '../models/conversation_state.dart';

/// Displays the current agent status (what the agent is doing).
///
/// Shows tool execution status from ACP `tool_call` events (text mode) or
/// Ganglia `status` events (voice mode). Both produce a [ToolStatus] with
/// a [ToolStatus.kind] for icon/color selection and a [ToolStatus.displayText]
/// for the human-readable label.
class StatusBar extends StatelessWidget {
  final ToolStatus? status;

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
            color: _getStatusColor(status!.kind).withOpacity(0.3),
          ),
          boxShadow: [
            BoxShadow(
              color: _getStatusColor(status!.kind).withOpacity(0.1),
              blurRadius: 8,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            _StatusIcon(kind: status!.kind),
            const SizedBox(width: 10),
            Flexible(
              child: Text(
                status!.displayText,
                style: TextStyle(
                  color: _getStatusColor(status!.kind),
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

  Color _getStatusColor(String kind) {
    switch (kind) {
      case 'think':
        return const Color(0xFFF59E0B); // Amber
      case 'search':
        return const Color(0xFF3B82F6); // Blue
      case 'read':
        return const Color(0xFF10B981); // Green
      case 'edit':
        return const Color(0xFFF97316); // Orange
      case 'fetch':
        return const Color(0xFF8B5CF6); // Purple
      case 'execute':
        return const Color(0xFFEF4444); // Red
      case 'delete':
        return const Color(0xFFEF4444); // Red
      case 'move':
        return const Color(0xFFF97316); // Orange
      default: // 'other' and anything unknown
        return const Color(0xFF06B6D4); // Cyan
    }
  }
}

/// Animated icon for tool status kinds.
class _StatusIcon extends StatefulWidget {
  final String kind;

  const _StatusIcon({required this.kind});

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
    return widget.kind == 'think' ||
        widget.kind == 'search' ||
        widget.kind == 'other';
  }

  IconData _getIcon() {
    switch (widget.kind) {
      case 'think':
        return Icons.psychology_outlined;
      case 'search':
        return Icons.search_rounded;
      case 'read':
        return Icons.description_outlined;
      case 'edit':
        return Icons.edit_rounded;
      case 'fetch':
        return Icons.language_rounded;
      case 'execute':
        return Icons.terminal_rounded;
      case 'delete':
        return Icons.delete_outline_rounded;
      case 'move':
        return Icons.drive_file_move_outline_rounded;
      default: // 'other' and anything unknown
        return Icons.analytics_outlined;
    }
  }

  Color _getColor() {
    switch (widget.kind) {
      case 'think':
        return const Color(0xFFF59E0B); // Amber
      case 'search':
        return const Color(0xFF3B82F6); // Blue
      case 'read':
        return const Color(0xFF10B981); // Green
      case 'edit':
        return const Color(0xFFF97316); // Orange
      case 'fetch':
        return const Color(0xFF8B5CF6); // Purple
      case 'execute':
        return const Color(0xFFEF4444); // Red
      case 'delete':
        return const Color(0xFFEF4444); // Red
      case 'move':
        return const Color(0xFFF97316); // Orange
      default: // 'other' and anything unknown
        return const Color(0xFF06B6D4); // Cyan
    }
  }
}
