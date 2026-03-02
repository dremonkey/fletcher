import 'package:flutter/material.dart';
import '../models/conversation_state.dart';
import '../services/livekit_service.dart';

/// Shows the transcript drawer as a bottom sheet.
///
/// Accepts a [LiveKitService] so the drawer can listen for live updates
/// while it's open (fixes BUG-013: stale transcript when panel is mounted).
void showTranscriptDrawer(
  BuildContext context, {
  required LiveKitService service,
}) {
  showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (context) => TranscriptDrawer(service: service),
  );
}

/// A chip that indicates transcript is available.
class TranscriptChip extends StatelessWidget {
  final int count;
  final VoidCallback onTap;

  const TranscriptChip({
    super.key,
    required this.count,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    if (count == 0) return const SizedBox.shrink();

    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: const Color(0xFF1F1F1F),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: const Color(0xFFF59E0B).withOpacity(0.4),
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(
              Icons.subtitles_rounded,
              size: 16,
              color: Color(0xFFF59E0B),
            ),
            const SizedBox(width: 6),
            Text(
              'Transcript',
              style: const TextStyle(
                color: Color(0xFFF59E0B),
                fontSize: 12,
                fontWeight: FontWeight.w500,
              ),
            ),
            const SizedBox(width: 4),
            const Icon(
              Icons.keyboard_arrow_up_rounded,
              size: 16,
              color: Color(0xFFF59E0B),
            ),
          ],
        ),
      ),
    );
  }
}

/// Full transcript drawer with chat-style layout.
///
/// Listens to [LiveKitService] directly so it receives live transcript
/// updates while the bottom sheet is open (BUG-013 fix).
class TranscriptDrawer extends StatefulWidget {
  final LiveKitService service;

  const TranscriptDrawer({
    super.key,
    required this.service,
  });

  @override
  State<TranscriptDrawer> createState() => _TranscriptDrawerState();
}

class _TranscriptDrawerState extends State<TranscriptDrawer> {
  final ScrollController _scrollController = ScrollController();
  int _lastTranscriptLength = 0;

  @override
  void initState() {
    super.initState();
    widget.service.addListener(_onServiceChanged);
    _lastTranscriptLength = widget.service.state.transcript.length;
    // Scroll to bottom after first frame
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _scrollToBottom();
    });
  }

  @override
  void dispose() {
    widget.service.removeListener(_onServiceChanged);
    _scrollController.dispose();
    super.dispose();
  }

  void _onServiceChanged() {
    if (!mounted) return;
    final newLength = widget.service.state.transcript.length;
    final shouldScroll = newLength > _lastTranscriptLength;
    _lastTranscriptLength = newLength;
    setState(() {});
    if (shouldScroll) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _scrollToBottom(animate: true);
      });
    }
  }

  void _scrollToBottom({bool animate = false}) {
    if (!_scrollController.hasClients) return;
    final target = _scrollController.position.maxScrollExtent;
    if (animate) {
      _scrollController.animateTo(
        target,
        duration: const Duration(milliseconds: 200),
        curve: Curves.easeOut,
      );
    } else {
      _scrollController.jumpTo(target);
    }
  }

  @override
  Widget build(BuildContext context) {
    final height = MediaQuery.of(context).size.height * 0.7;
    final transcript = widget.service.state.transcript;

    return Container(
      height: height,
      decoration: const BoxDecoration(
        color: Color(0xFF0D0D0D),
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        border: Border(
          top: BorderSide(color: Color(0xFF2D2D2D)),
          left: BorderSide(color: Color(0xFF2D2D2D)),
          right: BorderSide(color: Color(0xFF2D2D2D)),
        ),
      ),
      child: Column(
        children: [
          // Handle bar
          Container(
            margin: const EdgeInsets.only(top: 12),
            width: 40,
            height: 4,
            decoration: BoxDecoration(
              color: const Color(0xFF4B5563),
              borderRadius: BorderRadius.circular(2),
            ),
          ),

          // Header
          Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text(
                  'Transcript',
                  style: TextStyle(
                    color: Color(0xFFE5E7EB),
                    fontSize: 18,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                IconButton(
                  icon: const Icon(
                    Icons.close_rounded,
                    color: Color(0xFF6B7280),
                    size: 20,
                  ),
                  onPressed: () => Navigator.pop(context),
                ),
              ],
            ),
          ),

          // Transcript messages
          Expanded(
            child: transcript.isEmpty
                ? const Center(
                    child: Text(
                      'No transcript yet',
                      style: TextStyle(color: Color(0xFF6B7280)),
                    ),
                  )
                : ListView.builder(
                    controller: _scrollController,
                    padding: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 8,
                    ),
                    itemCount: transcript.length,
                    itemBuilder: (context, index) {
                      final entry = transcript[index];
                      return _TranscriptBubble(entry: entry);
                    },
                  ),
          ),
        ],
      ),
    );
  }
}

/// A single chat-style transcript bubble.
class _TranscriptBubble extends StatelessWidget {
  final TranscriptEntry entry;

  const _TranscriptBubble({required this.entry});

  @override
  Widget build(BuildContext context) {
    final isUser = entry.role == TranscriptRole.user;

    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        mainAxisAlignment:
            isUser ? MainAxisAlignment.end : MainAxisAlignment.start,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (!isUser) const SizedBox(width: 8),
          Flexible(
            child: Container(
              constraints: BoxConstraints(
                maxWidth: MediaQuery.of(context).size.width * 0.72,
              ),
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                color: isUser
                    ? const Color(0xFFF59E0B).withOpacity(0.15)
                    : const Color(0xFF1F1F1F),
                borderRadius: BorderRadius.only(
                  topLeft: const Radius.circular(16),
                  topRight: const Radius.circular(16),
                  bottomLeft: Radius.circular(isUser ? 16 : 4),
                  bottomRight: Radius.circular(isUser ? 4 : 16),
                ),
                border: Border.all(
                  color: isUser
                      ? const Color(0xFFF59E0B).withOpacity(0.3)
                      : const Color(0xFF2D2D2D),
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    entry.speaker,
                    style: TextStyle(
                      color: isUser
                          ? const Color(0xFFF59E0B)
                          : const Color(0xFF9CA3AF),
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    entry.text,
                    style: TextStyle(
                      color: const Color(0xFFE5E7EB),
                      fontSize: 14,
                      fontStyle:
                          entry.isFinal ? FontStyle.normal : FontStyle.italic,
                      height: 1.4,
                    ),
                  ),
                ],
              ),
            ),
          ),
          if (isUser) const SizedBox(width: 8),
        ],
      ),
    );
  }
}
