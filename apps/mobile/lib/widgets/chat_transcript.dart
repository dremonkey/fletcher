import 'package:flutter/material.dart';

import '../models/command_result.dart';
import '../models/conversation_state.dart';
import '../models/system_event.dart';
import '../services/livekit_service.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../theme/app_typography.dart';
import '../theme/tui_widgets.dart';
import '../utils/agent_text_parser.dart';
import 'command_result_card.dart';
import 'system_event_card.dart';
import 'thinking_block.dart';
import 'thinking_spinner.dart';
import 'tool_call_card.dart';

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
  int _lastItemCount = 0;
  bool _userHasScrolledUp = false;

  @override
  void initState() {
    super.initState();
    widget.service.addListener(_onServiceChanged);
    _scrollController.addListener(_onScroll);
    _lastItemCount = widget.service.state.transcript.length +
        widget.service.state.systemEvents.length +
        widget.service.state.activeToolCalls.length +
        widget.service.state.commandResults.length;
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
    final state = widget.service.state;
    final thinkingCount = state.isAgentThinking ? 1 : 0;
    final newCount = state.transcript.length +
        state.systemEvents.length +
        state.activeToolCalls.length +
        state.commandResults.length +
        thinkingCount;
    final hasNewItems = newCount > _lastItemCount;
    _lastItemCount = newCount;
    setState(() {});
    // TASK-077: Suppress auto-scroll during session history replay.
    // After replay completes, jump to bottom (no animation) once.
    if (hasNewItems && !_userHasScrolledUp && !widget.service.isReplaying) {
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
    final systemEvents = state.systemEvents;

    // Build timestamped items from transcript entries
    final timestampedItems = <_TimestampedItem>[];

    for (int i = 0; i < transcript.length; i++) {
      final entry = transcript[i];
      timestampedItems.add(_TimestampedItem(
        timestamp: entry.timestamp,
        item: _ChatItem.message(entry),
      ));
    }

    // Add system events
    for (final event in systemEvents) {
      timestampedItems.add(_TimestampedItem(
        timestamp: event.timestamp,
        item: _ChatItem.systemEvent(event),
      ));
    }

    // Add command results
    for (final result in state.commandResults) {
      timestampedItems.add(_TimestampedItem(
        timestamp: result.timestamp,
        item: _ChatItem.commandResult(result),
      ));
    }

    // Sort by timestamp
    timestampedItems.sort((a, b) => a.timestamp.compareTo(b.timestamp));

    // Build final items list with dividers between exchange pairs
    final items = <_ChatItem>[];
    TranscriptRole? lastMessageRole;

    for (final ti in timestampedItems) {
      final item = ti.item;
      if (item.isMessage) {
        // Add divider between exchange pairs (after agent, before user)
        if (lastMessageRole != null &&
            lastMessageRole != item.entry!.role &&
            lastMessageRole == TranscriptRole.agent) {
          items.add(const _ChatItem.divider());
        }
        lastMessageRole = item.entry!.role;
      }
      items.add(item);
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

    // Insert active tool call indicators before the thinking spinner.
    // Tool calls appear inline between the user message and agent response.
    for (final toolCall in state.activeToolCalls) {
      items.add(_ChatItem.toolCall(toolCall));
    }

    // Append thinking spinner as last item when agent is thinking
    if (state.isAgentThinking) {
      items.add(const _ChatItem.thinking());
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
        if (item.isSystemEvent) {
          return Padding(
            padding: const EdgeInsets.only(bottom: AppSpacing.sm),
            child: SystemEventCard(event: item.systemEvent!),
          );
        }
        if (item.isThinking) {
          return const Padding(
            padding: EdgeInsets.only(bottom: AppSpacing.sm),
            child: ThinkingSpinner(),
          );
        }
        if (item.isToolCall) {
          return ToolCallCard(toolCall: item.toolCall!);
        }
        if (item.isCommandResult) {
          return Padding(
            padding: const EdgeInsets.only(bottom: AppSpacing.sm),
            child: CommandResultCard(result: item.commandResult!),
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

/// Helper for sorting items by timestamp before building the list.
class _TimestampedItem {
  final DateTime timestamp;
  final _ChatItem item;

  const _TimestampedItem({required this.timestamp, required this.item});
}

/// Represents a message, system event, divider, thinking spinner, tool
/// call indicator, or command result in the chat list.
class _ChatItem {
  final TranscriptEntry? entry;
  final SystemEvent? systemEvent;
  final ToolCallInfo? toolCall;
  final CommandResult? commandResult;
  final bool isDivider;
  final bool isThinking;

  const _ChatItem.message(this.entry)
      : isDivider = false,
        isThinking = false,
        systemEvent = null,
        toolCall = null,
        commandResult = null;
  const _ChatItem.divider()
      : entry = null,
        isDivider = true,
        isThinking = false,
        systemEvent = null,
        toolCall = null,
        commandResult = null;
  const _ChatItem.systemEvent(this.systemEvent)
      : entry = null,
        isDivider = false,
        isThinking = false,
        toolCall = null,
        commandResult = null;
  const _ChatItem.thinking()
      : entry = null,
        isDivider = false,
        isThinking = true,
        systemEvent = null,
        toolCall = null,
        commandResult = null;
  const _ChatItem.toolCall(this.toolCall)
      : entry = null,
        isDivider = false,
        isThinking = false,
        systemEvent = null,
        commandResult = null;
  const _ChatItem.commandResult(this.commandResult)
      : entry = null,
        isDivider = false,
        isThinking = false,
        systemEvent = null,
        toolCall = null;

  bool get isMessage => entry != null;
  bool get isSystemEvent => systemEvent != null;
  bool get isToolCall => toolCall != null;
  bool get isCommandResult => commandResult != null;
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
          Row(
            children: [
              Expanded(
                child: TuiHeader(
                  label: entry.speaker,
                  color: headerColor,
                ),
              ),
              // Subtle keyboard icon for text-origin messages
              if (entry.origin == MessageOrigin.text)
                Padding(
                  padding: const EdgeInsets.only(right: AppSpacing.sm),
                  child: Icon(
                    Icons.keyboard_rounded,
                    size: 14,
                    color: AppColors.textSecondary.withAlpha(128),
                  ),
                ),
              Text(
                _formatTimestamp(entry.timestamp),
                style: AppTypography.overline,
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          if (isAgent) ...[
            () {
              final parsed = parseAgentText(entry.text);
              debugPrint('[ChatTranscript] parseAgentText: '
                  'thinkingState=${parsed.thinkingState} '
                  'thinking=${parsed.thinking != null ? '"${parsed.thinking!.substring(0, parsed.thinking!.length.clamp(0, 40))}..."' : 'null'} '
                  'visible="${parsed.visible.substring(0, parsed.visible.length.clamp(0, 40))}..." '
                  'rawLen=${entry.text.length} '
                  'rawStart="${entry.text.substring(0, entry.text.length.clamp(0, 60))}"');
              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (parsed.thinkingState != ThinkingState.none)
                    ThinkingBlock(
                      text: parsed.thinking,
                      state: parsed.thinkingState,
                    ),
                  if (parsed.thinkingState != ThinkingState.none &&
                      parsed.visible.isNotEmpty)
                    const SizedBox(height: AppSpacing.xs),
                  if (parsed.visible.isNotEmpty)
                    Text(
                      parsed.visible,
                      style: AppTypography.body.copyWith(
                        fontStyle:
                            entry.isFinal ? FontStyle.normal : FontStyle.italic,
                        color: entry.isFinal
                            ? AppColors.textPrimary
                            : AppColors.textSecondary,
                      ),
                    ),
                ],
              );
            }(),
          ] else ...[
            Text(
              entry.text,
              style: AppTypography.body.copyWith(
                fontStyle: entry.isFinal ? FontStyle.normal : FontStyle.italic,
                color: entry.isFinal
                    ? AppColors.textPrimary
                    : AppColors.textSecondary,
              ),
            ),
          ],
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
