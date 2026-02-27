import 'package:flutter/material.dart';
import '../models/conversation_state.dart';

/// Shows the most recent active transcription as a subtitle overlay.
/// Tapping opens the full transcript drawer.
class TranscriptSubtitle extends StatelessWidget {
  final TranscriptEntry? userTranscript;
  final TranscriptEntry? agentTranscript;
  final VoidCallback onTap;

  const TranscriptSubtitle({
    super.key,
    this.userTranscript,
    this.agentTranscript,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    // Show the most recently active transcript (prefer agent if both exist)
    final entry = agentTranscript ?? userTranscript;
    if (entry == null) return const SizedBox.shrink();

    return GestureDetector(
      onTap: onTap,
      child: AnimatedOpacity(
        opacity: 1.0,
        duration: const Duration(milliseconds: 200),
        child: Container(
          margin: const EdgeInsets.symmetric(horizontal: 24),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          decoration: BoxDecoration(
            color: const Color(0xFF1F1F1F).withOpacity(0.85),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                children: [
                  // Speaker label
                  Text(
                    entry.speaker,
                    style: TextStyle(
                      color: entry.role == TranscriptRole.user
                          ? const Color(0xFFF59E0B)
                          : const Color(0xFF9CA3AF),
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const Spacer(),
                  // Pull-up hint
                  const Icon(
                    Icons.keyboard_arrow_up_rounded,
                    size: 16,
                    color: Color(0xFF6B7280),
                  ),
                ],
              ),
              const SizedBox(height: 4),
              // Transcript text
              SizedBox(
                width: double.infinity,
                child: Text(
                  entry.text,
                  style: TextStyle(
                    color: const Color(0xFFE5E7EB),
                    fontSize: 14,
                    fontStyle:
                        entry.isFinal ? FontStyle.normal : FontStyle.italic,
                  ),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
