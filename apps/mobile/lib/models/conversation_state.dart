enum ConversationStatus {
  connecting,
  idle,
  userSpeaking,
  processing,
  aiSpeaking,
  muted,
  error,
}

class ConversationState {
  final ConversationStatus status;
  final double userAudioLevel;
  final double aiAudioLevel;
  final String? errorMessage;
  final List<TranscriptEntry> transcript;

  const ConversationState({
    this.status = ConversationStatus.connecting,
    this.userAudioLevel = 0.0,
    this.aiAudioLevel = 0.0,
    this.errorMessage,
    this.transcript = const [],
  });

  ConversationState copyWith({
    ConversationStatus? status,
    double? userAudioLevel,
    double? aiAudioLevel,
    String? errorMessage,
    List<TranscriptEntry>? transcript,
  }) {
    return ConversationState(
      status: status ?? this.status,
      userAudioLevel: userAudioLevel ?? this.userAudioLevel,
      aiAudioLevel: aiAudioLevel ?? this.aiAudioLevel,
      errorMessage: errorMessage ?? this.errorMessage,
      transcript: transcript ?? this.transcript,
    );
  }
}

class TranscriptEntry {
  final String speaker;
  final String text;
  final DateTime timestamp;

  const TranscriptEntry({
    required this.speaker,
    required this.text,
    required this.timestamp,
  });
}
