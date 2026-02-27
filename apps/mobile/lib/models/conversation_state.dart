enum ConversationStatus {
  connecting,
  idle,
  userSpeaking,
  processing,
  aiSpeaking,
  muted,
  error,
}

// Ganglia Event Types

/// Status actions from the agent
enum StatusAction {
  thinking,
  searchingFiles,
  readingFile,
  writingFile,
  editingFile,
  webSearch,
  executingCommand,
  analyzing,
}

/// Status event - shows what the agent is currently doing
class StatusEvent {
  final StatusAction action;
  final String? detail;
  final DateTime startedAt;

  const StatusEvent({
    required this.action,
    this.detail,
    required this.startedAt,
  });

  factory StatusEvent.fromJson(Map<String, dynamic> json) {
    return StatusEvent(
      action: _parseStatusAction(json['action'] as String),
      detail: json['detail'] as String?,
      startedAt: json['startedAt'] != null
          ? DateTime.fromMillisecondsSinceEpoch(json['startedAt'] as int)
          : DateTime.now(),
    );
  }

  static StatusAction _parseStatusAction(String action) {
    switch (action) {
      case 'thinking':
        return StatusAction.thinking;
      case 'searching_files':
        return StatusAction.searchingFiles;
      case 'reading_file':
        return StatusAction.readingFile;
      case 'writing_file':
        return StatusAction.writingFile;
      case 'editing_file':
        return StatusAction.editingFile;
      case 'web_search':
        return StatusAction.webSearch;
      case 'executing_command':
        return StatusAction.executingCommand;
      case 'analyzing':
        return StatusAction.analyzing;
      default:
        return StatusAction.thinking;
    }
  }

  String get displayText {
    switch (action) {
      case StatusAction.thinking:
        return 'Thinking...';
      case StatusAction.searchingFiles:
        return detail != null ? 'Searching: $detail' : 'Searching files...';
      case StatusAction.readingFile:
        return detail != null ? 'Reading: ${_shortenPath(detail!)}' : 'Reading file...';
      case StatusAction.writingFile:
        return detail != null ? 'Writing: ${_shortenPath(detail!)}' : 'Writing file...';
      case StatusAction.editingFile:
        return detail != null ? 'Editing: ${_shortenPath(detail!)}' : 'Editing file...';
      case StatusAction.webSearch:
        return detail != null ? 'Searching: $detail' : 'Web search...';
      case StatusAction.executingCommand:
        return detail != null ? 'Running: ${_shortenCommand(detail!)}' : 'Running command...';
      case StatusAction.analyzing:
        return 'Analyzing...';
    }
  }

  static String _shortenPath(String path) {
    final parts = path.split('/');
    if (parts.length > 2) {
      return '.../${parts.sublist(parts.length - 2).join('/')}';
    }
    return path;
  }

  static String _shortenCommand(String command) {
    if (command.length > 30) {
      return '${command.substring(0, 27)}...';
    }
    return command;
  }
}

/// Artifact types
enum ArtifactType {
  diff,
  code,
  markdown,
  file,
  searchResults,
  error,
  unknown,
}

/// Search result entry
class SearchResult {
  final String file;
  final int line;
  final String content;

  const SearchResult({
    required this.file,
    required this.line,
    required this.content,
  });

  factory SearchResult.fromJson(Map<String, dynamic> json) {
    return SearchResult(
      file: json['file'] as String,
      line: json['line'] as int,
      content: json['content'] as String,
    );
  }
}

/// Artifact event - visual content from tool execution
class ArtifactEvent {
  final ArtifactType artifactType;
  final String? title;

  // Diff artifact fields
  final String? file;
  final String? diff;

  // Code artifact fields
  final String? language;
  final String? content;
  final int? startLine;

  // File artifact fields
  final String? path;

  // Search results artifact fields
  final String? query;
  final List<SearchResult>? results;

  // Error artifact fields
  final String? message;
  final String? stack;

  // Raw JSON for unknown types
  final Map<String, dynamic>? rawJson;

  const ArtifactEvent({
    required this.artifactType,
    this.title,
    this.file,
    this.diff,
    this.language,
    this.content,
    this.startLine,
    this.path,
    this.query,
    this.results,
    this.message,
    this.stack,
    this.rawJson,
  });

  factory ArtifactEvent.fromJson(Map<String, dynamic> json) {
    final typeStr = json['artifact_type'] as String? ?? 'unknown';
    final artifactType = _parseArtifactType(typeStr);

    List<SearchResult>? results;
    if (json['results'] != null) {
      results = (json['results'] as List)
          .map((r) => SearchResult.fromJson(r as Map<String, dynamic>))
          .toList();
    }

    return ArtifactEvent(
      artifactType: artifactType,
      title: json['title'] as String?,
      file: json['file'] as String?,
      diff: json['diff'] as String?,
      language: json['language'] as String?,
      content: json['content'] as String?,
      startLine: json['startLine'] as int?,
      path: json['path'] as String?,
      query: json['query'] as String?,
      results: results,
      message: json['message'] as String?,
      stack: json['stack'] as String?,
      rawJson: artifactType == ArtifactType.unknown ? json : null,
    );
  }

  static ArtifactType _parseArtifactType(String type) {
    switch (type) {
      case 'markdown':
        return ArtifactType.markdown;
      case 'diff':
        return ArtifactType.diff;
      case 'code':
        return ArtifactType.code;
      case 'file':
        return ArtifactType.file;
      case 'search_results':
        return ArtifactType.searchResults;
      case 'error':
        return ArtifactType.error;
      default:
        return ArtifactType.unknown;
    }
  }

  String get displayTitle {
    if (title != null) return title!;
    switch (artifactType) {
      case ArtifactType.diff:
        return file ?? 'Changes';
      case ArtifactType.markdown:
        return path ?? 'Document';
      case ArtifactType.code:
        return file ?? 'Code';
      case ArtifactType.file:
        return path ?? 'File';
      case ArtifactType.searchResults:
        return query != null ? 'Search: $query' : 'Search Results';
      case ArtifactType.error:
        return 'Error';
      case ArtifactType.unknown:
        return 'Unknown Artifact';
    }
  }
}

class ConversationState {
  final ConversationStatus status;
  final double userAudioLevel;
  final double aiAudioLevel;
  final String? errorMessage;
  final List<TranscriptEntry> transcript;

  /// Current status event from ganglia (what the agent is doing)
  final StatusEvent? currentStatus;

  /// List of artifacts received from ganglia (code, diffs, etc.)
  final List<ArtifactEvent> artifacts;

  /// Rolling waveform buffers for visualization (~30 samples = 3s at 100ms)
  final List<double> userWaveform;
  final List<double> aiWaveform;

  /// Current in-progress transcriptions for subtitle display
  final TranscriptEntry? currentUserTranscript;
  final TranscriptEntry? currentAgentTranscript;

  const ConversationState({
    this.status = ConversationStatus.connecting,
    this.userAudioLevel = 0.0,
    this.aiAudioLevel = 0.0,
    this.errorMessage,
    this.transcript = const [],
    this.currentStatus,
    this.artifacts = const [],
    this.userWaveform = const [],
    this.aiWaveform = const [],
    this.currentUserTranscript,
    this.currentAgentTranscript,
  });

  ConversationState copyWith({
    ConversationStatus? status,
    double? userAudioLevel,
    double? aiAudioLevel,
    String? errorMessage,
    List<TranscriptEntry>? transcript,
    StatusEvent? currentStatus,
    bool clearStatus = false,
    List<ArtifactEvent>? artifacts,
    List<double>? userWaveform,
    List<double>? aiWaveform,
    TranscriptEntry? currentUserTranscript,
    bool clearCurrentUserTranscript = false,
    TranscriptEntry? currentAgentTranscript,
    bool clearCurrentAgentTranscript = false,
  }) {
    return ConversationState(
      status: status ?? this.status,
      userAudioLevel: userAudioLevel ?? this.userAudioLevel,
      aiAudioLevel: aiAudioLevel ?? this.aiAudioLevel,
      errorMessage: errorMessage ?? this.errorMessage,
      transcript: transcript ?? this.transcript,
      currentStatus: clearStatus ? null : (currentStatus ?? this.currentStatus),
      artifacts: artifacts ?? this.artifacts,
      userWaveform: userWaveform ?? this.userWaveform,
      aiWaveform: aiWaveform ?? this.aiWaveform,
      currentUserTranscript: clearCurrentUserTranscript
          ? null
          : (currentUserTranscript ?? this.currentUserTranscript),
      currentAgentTranscript: clearCurrentAgentTranscript
          ? null
          : (currentAgentTranscript ?? this.currentAgentTranscript),
    );
  }
}

enum TranscriptRole { user, agent }

class TranscriptEntry {
  final String id;
  final TranscriptRole role;
  final String text;
  final bool isFinal;
  final DateTime timestamp;

  const TranscriptEntry({
    required this.id,
    required this.role,
    required this.text,
    this.isFinal = false,
    required this.timestamp,
  });

  String get speaker => role == TranscriptRole.user ? 'You' : 'Fletcher';

  TranscriptEntry copyWith({
    String? text,
    bool? isFinal,
  }) {
    return TranscriptEntry(
      id: id,
      role: role,
      text: text ?? this.text,
      isFinal: isFinal ?? this.isFinal,
      timestamp: timestamp,
    );
  }
}
