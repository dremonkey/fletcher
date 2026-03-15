import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'command_result.dart';
import 'system_event.dart';

enum ConversationStatus {
  connecting,
  reconnecting,
  idle,
  userSpeaking,
  processing,
  aiSpeaking,
  muted,
  error,
}

/// Whether the user is in voice-first mode (default) or text-input mode
/// (safety hatch for noisy/quiet environments or precision typing).
enum TextInputMode {
  voiceFirst,
  textInput,
}

/// The origin of a transcript message — voice (STT) or typed text.
enum MessageOrigin {
  voice,
  text,
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
        return detail ?? 'Thinking...';
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

  /// The ID of the agent transcript message this artifact is associated with.
  /// Used to render the artifact inline below its originating message.
  final String? messageId;

  /// When this artifact was created (received by the client).
  final DateTime createdAt;

  ArtifactEvent({
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
    this.messageId,
    DateTime? createdAt,
  }) : createdAt = createdAt ?? DateTime.now();

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

  /// Returns a copy of this artifact with the given [messageId].
  ArtifactEvent withMessageId(String? messageId) {
    return ArtifactEvent(
      artifactType: artifactType,
      title: title,
      file: file,
      diff: diff,
      language: language,
      content: content,
      startLine: startLine,
      path: path,
      query: query,
      results: results,
      message: message,
      stack: stack,
      rawJson: rawJson,
      messageId: messageId,
      createdAt: createdAt,
    );
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

/// Diagnostics data for the diagnostics panel.
///
/// Holds live pipeline values such as round-trip latency, session/room name,
/// agent identity, connection time, and pipeline provider names (when available
/// from agent metadata).
class DiagnosticsInfo {
  /// Measured round-trip latency in milliseconds (user speech end → agent speech start).
  final int? roundTripMs;

  /// Current room/session name.
  final String? sessionName;

  /// Agent participant identity (from LiveKit room).
  final String? agentIdentity;

  /// Timestamp when the room connection was established.
  final DateTime? connectedAt;

  /// Pipeline provider names — populated from agent metadata if available.
  final String? sttProvider;
  final String? ttsProvider;
  final String? llmProvider;

  /// Token usage from ACP `usage_update` events.
  /// [tokenUsed] is the number of tokens consumed; [tokenSize] is the context
  /// window limit. Both are null until the first usage update arrives.
  final int? tokenUsed;
  final int? tokenSize;

  const DiagnosticsInfo({
    this.roundTripMs,
    this.sessionName,
    this.agentIdentity,
    this.connectedAt,
    this.sttProvider,
    this.ttsProvider,
    this.llmProvider,
    this.tokenUsed,
    this.tokenSize,
  });

  /// Human-readable token usage string, e.g. `'35K / 1M'`.
  /// Returns null when no usage data has been received yet.
  String? get tokenDisplay {
    if (tokenUsed == null || tokenSize == null) return null;
    final usedK = (tokenUsed! / 1000).toStringAsFixed(0);
    final sizeK = tokenSize! >= 1000000
        ? '${(tokenSize! / 1000000).toStringAsFixed(0)}M'
        : '${(tokenSize! / 1000).toStringAsFixed(0)}K';
    return '${usedK}K / $sizeK';
  }

  /// Fraction of the context window consumed (0.0–1.0).
  /// Returns null when no usage data has been received yet.
  double? get tokenPercentage =>
      tokenUsed != null && tokenSize != null && tokenSize! > 0
          ? tokenUsed! / tokenSize!
          : null;

  DiagnosticsInfo copyWith({
    int? roundTripMs,
    bool clearRoundTripMs = false,
    String? sessionName,
    String? agentIdentity,
    bool clearAgentIdentity = false,
    DateTime? connectedAt,
    bool clearConnectedAt = false,
    String? sttProvider,
    String? ttsProvider,
    String? llmProvider,
    int? tokenUsed,
    bool clearTokenUsed = false,
    int? tokenSize,
    bool clearTokenSize = false,
  }) {
    return DiagnosticsInfo(
      roundTripMs: clearRoundTripMs ? null : (roundTripMs ?? this.roundTripMs),
      sessionName: sessionName ?? this.sessionName,
      agentIdentity: clearAgentIdentity ? null : (agentIdentity ?? this.agentIdentity),
      connectedAt: clearConnectedAt ? null : (connectedAt ?? this.connectedAt),
      sttProvider: sttProvider ?? this.sttProvider,
      ttsProvider: ttsProvider ?? this.ttsProvider,
      llmProvider: llmProvider ?? this.llmProvider,
      tokenUsed: clearTokenUsed ? null : (tokenUsed ?? this.tokenUsed),
      tokenSize: clearTokenSize ? null : (tokenSize ?? this.tokenSize),
    );
  }

  /// Format uptime duration as HH:MM:SS or MM:SS.
  static String formatUptime(Duration duration) {
    final hours = duration.inHours;
    final minutes = duration.inMinutes.remainder(60);
    final seconds = duration.inSeconds.remainder(60);
    if (hours > 0) {
      return '${hours.toString().padLeft(2, '0')}:'
          '${minutes.toString().padLeft(2, '0')}:'
          '${seconds.toString().padLeft(2, '0')}';
    }
    return '${minutes.toString().padLeft(2, '0')}:'
        '${seconds.toString().padLeft(2, '0')}';
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

  /// Inline system events (connection lifecycle) shown in chat transcript
  final List<SystemEvent> systemEvents;

  /// Whether the agent is currently thinking (between user finishing speaking
  /// and first agent transcript text arriving).
  final bool isAgentThinking;

  /// Live diagnostics info (round-trip latency, session, agent, uptime, providers).
  final DiagnosticsInfo diagnostics;

  /// Current input mode — voice-first (default) or text-input (safety hatch).
  final TextInputMode inputMode;

  /// Active tool calls from ACP verbose mode.
  ///
  /// Contains in-progress and recently completed tool calls. The list grows
  /// as `tool_call` events arrive and entries are updated when
  /// `tool_call_update` events complete them. Cleared between prompt turns.
  final List<ToolCallInfo> activeToolCalls;

  /// Results from slash command executions shown inline in the chat transcript.
  final List<CommandResult> commandResults;

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
    this.systemEvents = const [],
    this.isAgentThinking = false,
    this.diagnostics = const DiagnosticsInfo(),
    this.inputMode = TextInputMode.textInput,
    this.activeToolCalls = const [],
    this.commandResults = const [],
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
    List<SystemEvent>? systemEvents,
    bool? isAgentThinking,
    DiagnosticsInfo? diagnostics,
    TextInputMode? inputMode,
    List<ToolCallInfo>? activeToolCalls,
    List<CommandResult>? commandResults,
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
      systemEvents: systemEvents ?? this.systemEvents,
      isAgentThinking: isAgentThinking ?? this.isAgentThinking,
      diagnostics: diagnostics ?? this.diagnostics,
      inputMode: inputMode ?? this.inputMode,
      activeToolCalls: activeToolCalls ?? this.activeToolCalls,
      commandResults: commandResults ?? this.commandResults,
    );
  }
}

/// Represents a single tool call initiated by the ACP agent.
///
/// Tool calls are surfaced when verbose mode is enabled (`verbose: true` in
/// `session/new`). The relay receives `tool_call` / `tool_call_update` events
/// and the mobile shows them as inline indicators in the chat transcript.
class ToolCallInfo {
  final String id;
  final String name;
  final DateTime startedAt;

  /// null = in-progress; "completed" / "error" = finished.
  final String? status;

  /// Wall-clock duration from [startedAt] to completion.
  /// Only available once [status] is set (non-null).
  final Duration? duration;

  const ToolCallInfo({
    required this.id,
    required this.name,
    required this.startedAt,
    this.status,
    this.duration,
  });

  ToolCallInfo copyWith({String? status, Duration? duration}) => ToolCallInfo(
    id: id,
    name: name,
    startedAt: startedAt,
    status: status ?? this.status,
    duration: duration ?? this.duration,
  );
}

enum TranscriptRole { user, agent }

class TranscriptEntry {
  final String id;
  final TranscriptRole role;
  final String text;
  final bool isFinal;
  final DateTime timestamp;

  /// How this message was created — voice (STT) or typed text.
  /// Defaults to [MessageOrigin.voice] for backward compatibility.
  final MessageOrigin origin;

  const TranscriptEntry({
    required this.id,
    required this.role,
    required this.text,
    this.isFinal = false,
    required this.timestamp,
    this.origin = MessageOrigin.voice,
  });

  String get speaker => role == TranscriptRole.user ? 'You' : (dotenv.env['AGENT_NAME'] ?? 'Fletcher');

  TranscriptEntry copyWith({
    String? text,
    bool? isFinal,
    MessageOrigin? origin,
  }) {
    return TranscriptEntry(
      id: id,
      role: role,
      text: text ?? this.text,
      isFinal: isFinal ?? this.isFinal,
      timestamp: timestamp,
      origin: origin ?? this.origin,
    );
  }
}
