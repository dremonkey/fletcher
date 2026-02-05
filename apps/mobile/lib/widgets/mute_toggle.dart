import 'package:flutter/material.dart';

class MuteToggle extends StatelessWidget {
  final bool isMuted;
  final VoidCallback onToggle;

  const MuteToggle({
    super.key,
    required this.isMuted,
    required this.onToggle,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onToggle,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        width: 48,
        height: 48,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: isMuted
              ? const Color(0xFFF59E0B).withOpacity(0.2)
              : const Color(0xFF4B5563).withOpacity(0.3),
          border: Border.all(
            color: isMuted
                ? const Color(0xFFF59E0B)
                : const Color(0xFF4B5563),
            width: 1.5,
          ),
        ),
        child: Icon(
          isMuted ? Icons.mic_off_rounded : Icons.mic_rounded,
          color: isMuted
              ? const Color(0xFFF59E0B)
              : const Color(0xFF4B5563),
          size: 24,
        ),
      ),
    );
  }
}
