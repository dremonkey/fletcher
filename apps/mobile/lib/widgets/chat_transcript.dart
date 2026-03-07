import 'package:flutter/material.dart';

import '../models/conversation_state.dart';
import '../services/livekit_service.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../theme/app_typography.dart';
import '../theme/tui_widgets.dart';

/// Primary chat transcript area displaying conversation messages.
///
/// Listens to [LiveKitService] directly for live updates.
/// Auto-scrolls to bottom on new messages, pauses when user scrolls up.
class ChatTranscript extends StatefulWidget {
  final LiveKitService service;

  const ChatTranscript({
    super.key,
    required this.service,
  });

  @override
  State<ChatTranscript> createState() => _ChatTranscriptState();
}

class _ChatTranscriptState extends State<ChatTranscript> {
  final ScrollController _scrollController = ScrollController();
  int _lastTranscriptLength = 0;
  bool _userHasScrolledUp = false;

  @override
  void initState() {
    super.initState();
    widget.service.addListener(_onServiceChanged);
    _scrollController.addListener(_onScroll);
    _lastTranscriptLength = widget.service.state.transcript.length;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _scrollToBottom();
    });
  }

  @override
  void dispose() {
    widget.service.removeListener(_onServiceChanged);
    _scrollController.removeListener(_onScroll);
    _scrollController.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (!_scrollController.hasClients) return;
    final maxScroll = _scrollController.position.maxScrollExtent;
    final currentScroll = _scrollController.position.pixels;
    // Resume auto-scroll when within 50px of bottom
    _userHasScrolledUp = (maxScroll - currentScroll) > 50;
  }

  void _onServiceChanged() {
    if (!mounted) return;
    final newLength = widget.service.state.transcript.length;
    final hasNewMessages = newLength > _lastTranscriptLength;
    _lastTranscriptLength = newLength;
    setState(() {});
    if (hasNewMessages && !_userHasScrolledUp) {
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
    final state = widget.service.state;
    final transcript = state.transcript;

    // Build the list of items: finalized transcript + live interim entries
    final items = <_ChatItem>[];

    for (int i = 0; i < transcript.length; i++) {
      final entry = transcript[i];

      // Add divider between exchange pairs (user->agent or agent->user)
      if (i > 0 && transcript[i - 1].role != entry.role &&
          transcript[i - 1].role == TranscriptRole.agent) {
        items.add(const _ChatItem.divider());
      }

      items.add(_ChatItem.message(entry));
    }

    // Add live interim transcripts if they are not already in the list
    final liveUser = state.currentUserTranscript;
    final liveAgent = state.currentAgentTranscript;

    if (liveUser != null && !liveUser.isFinal) {
      final alreadyShown = transcript.any((e) => e.id == liveUser.id);
      if (!alreadyShown) {
        items.add(_ChatItem.message(liveUser));
      }
    }

    if (liveAgent != null && !liveAgent.isFinal) {
      final alreadyShown = transcript.any((e) => e.id == liveAgent.id);
      if (!alreadyShown) {
        items.add(_ChatItem.message(liveAgent));
      }
    }

    if (items.isEmpty) {
      return Center(
        child: Text(
          'Waiting for conversation...',
          style: AppTypography.body.copyWith(color: AppColors.textSecondary),
        ),
      );
    }

    return ListView.builder(
      controller: _scrollController,
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.base,
        vertical: AppSpacing.sm,
      ),
      itemCount: items.length,
      itemBuilder: (context, index) {
        final item = items[index];
        if (item.isDivider) {
          return Padding(
            padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
            child: Divider(
              color: AppColors.textSecondary.withAlpha(77),
              height: 1,
            ),
          );
        }
        return Padding(
          padding: const EdgeInsets.only(bottom: AppSpacing.sm),
          child: _TranscriptMessage(entry: item.entry!),
        );
      },
    );
  }
}

/// Represents either a message or a divider in the chat list.
class _ChatItem {
  final TranscriptEntry? entry;
  final bool isDivider;

  const _ChatItem.message(this.entry) : isDivider = false;
  const _ChatItem.divider() : entry = null, isDivider = true;
}

/// A single transcript message rendered as a TuiCard.
class _TranscriptMessage extends StatelessWidget {
  final TranscriptEntry entry;

  const _TranscriptMessage({required this.entry});

  @override
  Widget build(BuildContext context) {
    final isAgent = entry.role == TranscriptRole.agent;
    final headerColor = isAgent ? AppColors.amber : AppColors.cyan;

    return TuiCard(
      borderColor: isAgent ? AppColors.amber : null,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          TuiHeader(
            label: entry.speaker,
            color: headerColor,
          ),
          const SizedBox(height: AppSpacing.sm),
          Text(
            entry.text,
            style: AppTypography.body.copyWith(
              fontStyle: entry.isFinal ? FontStyle.normal : FontStyle.italic,
              color: entry.isFinal
                  ? AppColors.textPrimary
                  : AppColors.textSecondary,
            ),
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            _formatTimestamp(entry.timestamp),
            style: AppTypography.overline,
          ),
        ],
      ),
    );
  }

  String _formatTimestamp(DateTime ts) {
    final h = ts.hour.toString().padLeft(2, '0');
    final m = ts.minute.toString().padLeft(2, '0');
    final s = ts.second.toString().padLeft(2, '0');
    return '$h:$m:$s';
  }
}
