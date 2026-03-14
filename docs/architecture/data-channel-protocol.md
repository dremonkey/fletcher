# Data Channel Protocol

Beyond the audio pipeline, Fletcher sends structured metadata from the voice agent to the mobile client via LiveKit's data transport. This includes real-time transcriptions, agent status updates, and visual artifacts (code diffs, search results, etc.).

## Transport Channels

| Channel | Transport | Direction | Content |
|---------|-----------|-----------|---------|
| `lk.transcription` | LiveKit Text Streams | Agent → Client | Real-time transcription of user and agent speech |
| `ganglia-events` | LiveKit Data Channel | Bidirectional | Status events, artifacts, content events (Agent → Client); control commands (Client → Agent) |

## Transcription Streams

Transcriptions are sent via LiveKit's built-in text stream API on the `lk.transcription` topic.

### Message Model

Each transcription segment has a unique `segmentId` and arrives as a series of chunks:

```typescript
// Per-segment state on the client
interface TranscriptEntry {
  id: string;            // segmentId from LiveKit
  role: 'user' | 'agent';
  text: string;
  isFinal: boolean;
  timestamp: DateTime;
}
```

### Update Semantics

User and agent transcripts use different update strategies:

| Speaker | Semantics | Behavior |
|---------|-----------|----------|
| User | **Full replacement** | Each chunk contains the complete text so far |
| Agent | **Delta** | Each chunk appends to previous content |

### Client-Side Lifecycle

1. `TextStreamReader` emits chunks for a segment
2. Content accumulates in a `segmentContent` map keyed by `segmentId`
3. `upsertTranscript()` updates or creates the `TranscriptEntry`
4. On final chunk: 3-second timer starts, then subtitle auto-clears
5. On stream close: segment state removed, entry marked final

## Ganglia Events

Status updates and artifacts are sent as binary-encoded UTF-8 JSON on the `ganglia-events` data channel topic.

### Event Types

```typescript
type GangliaEvent = StatusEvent | ArtifactEvent | ContentEvent;
```

#### StatusEvent

Reports what the agent is currently doing:

```typescript
interface StatusEvent {
  type: 'status';
  action: StatusAction;
  detail?: string;        // File path, search query, command, etc.
  startedAt?: number;     // Timestamp (ms)
}

type StatusAction =
  | 'thinking'
  | 'searching_files'
  | 'reading_file'
  | 'writing_file'
  | 'editing_file'
  | 'web_search'
  | 'executing_command'
  | 'analyzing';
```

Status events come from two sources:

1. **Tool execution** — The `ToolInterceptor` emits status events when tools execute (see table below).
2. **LLM pondering** — While waiting for the first content token from the LLM, the `OpenClawChatStream` emits `thinking` status events with rotating fun phrases in the `detail` field (e.g., "Dreaming of electric sheep...", "Summoning words...", "Reticulating splines..."). These rotate every 3 seconds and are cleared when the first content token arrives. The phrase list lives in `pondering.ts`.

A mapping table converts tool names to actions:

| Tool Name | Status Action |
|-----------|---------------|
| `Read`, `read_file` | `reading_file` |
| `Write`, `write_file` | `writing_file` |
| `Edit`, `edit_file` | `editing_file` |
| `Grep`, `Glob`, `search`, `grep`, `glob` | `searching_files` |
| `WebSearch`, `web_search` | `web_search` |
| `Bash`, `bash` | `executing_command` |

Status events are **debounced** — the same action must wait 500ms before being sent again. Different actions are sent immediately.

The mobile app displays these in the `StatusBar` widget and auto-clears them after 5 seconds.

#### ArtifactEvent

Visual content produced by tool execution:

```typescript
type ArtifactType = 'diff' | 'code' | 'markdown' | 'file' | 'search_results' | 'error';

// Example: DiffArtifact
interface DiffArtifact {
  type: 'artifact';
  artifact_type: 'diff';
  file: string;
  diff: string;         // Unified diff format
  title?: string;
}

// Example: CodeArtifact
interface CodeArtifact {
  type: 'artifact';
  artifact_type: 'code';
  language?: string;
  content: string;
  file?: string;
  startLine?: number;
  title?: string;
}

// Example: SearchResultsArtifact
interface SearchResultsArtifact {
  type: 'artifact';
  artifact_type: 'search_results';
  query: string;
  results: Array<{ file: string; line: number; content: string }>;
  title?: string;
}

// Example: ErrorArtifact
interface ErrorArtifact {
  type: 'artifact';
  artifact_type: 'error';
  message: string;
  stack?: string;
  title?: string;
}
```

The mobile app displays these in the `ArtifactViewer` widget (a tabbed bottom sheet), keeping the most recent 10 artifacts.

#### ContentEvent

Text content from the agent response stream:

```typescript
interface ContentEvent {
  type: 'content';
  delta: string;    // Text token
}
```

### Type Guards

```typescript
function isStatusEvent(event: GangliaEvent): event is StatusEvent;
function isArtifactEvent(event: GangliaEvent): event is ArtifactEvent;
function isContentEvent(event: GangliaEvent): event is ContentEvent;
```

## Client → Agent Commands

The mobile client can send control events to the voice agent on the same `ganglia-events` topic. These are JSON-encoded `publishData` calls with `reliable: true`.

### Text Message (Epic 17)

Sends a typed text message from the client to the voice agent, bypassing STT. The agent injects the text directly into the LLM pipeline as a user message, producing a response via the normal TTS + transcript flow.

```typescript
interface TextMessageEvent {
  type: 'text_message';
  text: string;           // The user's typed message
}
```

The agent handles this by:
1. Receiving the event on the `ganglia-events` data channel
2. Injecting the text as a user message into the current `AgentSession` conversation
3. The LLM responds normally — TTS synthesizes the response, transcript flows back via `lk.transcription`

This enables "safety hatch" text input when voice is impractical (noisy/quiet environments, network degradation, precision corrections). The text message shares the same conversation context as voice — no separate session or history.

### TTS Mode Toggle (TASK-030)

Disables or re-enables TTS synthesis on the agent. When TTS is off, the agent skips all TTS API calls and acknowledgment sounds — responses arrive as text only via the data channel transcript. STT remains active.

```typescript
interface TtsModeEvent {
  type: 'tts-mode';
  value: 'on' | 'off';
}
```

The client sends the current `tts-mode` state on room connect and reconnect so the agent always has the correct preference. The preference is persisted in `SharedPreferences` across app restarts.

On the agent side, `session.output.setAudioEnabled(enabled)` toggles TTS inference natively — when audio output is disabled, the SDK's `ttsTask` skips `performTTSInference` entirely.

**Bootstrap trigger:** The first `tts-mode` event with `value !== "off"` also triggers the voice agent's bootstrap message — a one-time synthetic user message that injects TTS/STT behavioral instructions into the session. This deferred bootstrap ensures the agent does not send a greeting or consume LLM resources until the user actually activates voice mode. For e2e test rooms (`e2e-*` prefix), bootstrap fires immediately on room join instead of waiting for a `tts-mode` event.

## Chunking Protocol

LiveKit data channels have a typical MTU of ~16KB. Messages larger than 14KB (headroom under the MTU) are split into chunks.

```mermaid
sequenceDiagram
    participant Agent as Voice Agent
    participant DC as Data Channel
    participant App as Mobile App

    Note over Agent: Large artifact (e.g., 40KB diff)

    Agent->>Agent: Serialize to JSON
    Agent->>Agent: Check size > 14KB
    Agent->>Agent: Base64 encode
    Agent->>Agent: Split into chunks

    Agent->>DC: Chunk 1/3<br/>{type: "chunk", transfer_id,<br/>chunk_index: 0, total_chunks: 3,<br/>data: "base64..."}
    Agent->>DC: Chunk 2/3<br/>{type: "chunk", transfer_id,<br/>chunk_index: 1, total_chunks: 3,<br/>data: "base64..."}
    Agent->>DC: Chunk 3/3<br/>{type: "chunk", transfer_id,<br/>chunk_index: 2, total_chunks: 3,<br/>data: "base64..."}

    App->>App: Buffer chunks by transfer_id
    App->>App: All 3 received?
    App->>App: Concatenate base64 data
    App->>App: Decode and parse JSON
    App->>App: Process as GangliaEvent
```

### Chunk Message Format

```typescript
interface ChunkMessage {
  type: 'chunk';
  transfer_id: string;     // Unique ID for this transfer
  chunk_index: number;      // 0-based index
  total_chunks: number;     // Total expected chunks
  data: string;             // Base64-encoded fragment
}
```

### Client-Side Reassembly

The mobile app (`LiveKitService`) maintains a buffer map:

```dart
Map<String, Map<int, String>> _chunks;  // transfer_id → {index → data}
```

When all chunks for a `transfer_id` are received:
1. Concatenate `data` fields in order
2. Base64 decode
3. Parse as JSON
4. Process as a normal `GangliaEvent`

Incomplete transfers are cleared on disconnect.

## Tool Interception Pipeline

The `ToolInterceptor` and `EventInterceptor` classes generate events from tool execution:

```
Tool Call → ToolInterceptor → StatusEvent (emitted before execution)
                            → Execute tool
                            → ArtifactEvent (emitted after success)
                            → ErrorArtifact (emitted on failure)

EventInterceptor → Status debouncing (500ms same-action)
                 → Size check (> 14KB?)
                 → Chunking if needed
                 → publishData() to data channel
```

### Artifact Generation

The interceptor automatically creates artifacts based on tool type:

| Tool | Artifact |
|------|----------|
| `Read` / `read_file` | `CodeArtifact` or `MarkdownArtifact` (based on file extension) |
| `Edit` / `edit_file` | `DiffArtifact` (generates unified diff from old/new strings) |
| `Grep` / `Glob` / `search` | `SearchResultsArtifact` (parses `file:line:content` format) |
| Any failing tool | `ErrorArtifact` |

Language detection for code artifacts uses file extension mapping (`.ts` → TypeScript, `.dart` → Dart, etc.).

## Related Documents

- [Voice Pipeline](voice-pipeline.md) — the audio flow that runs alongside data channels
- [Brain Plugin](brain-plugin.md) — where extended events originate (Nanoclaw backend)
- [Mobile Client](mobile-client.md) — how the Flutter app renders transcriptions and artifacts
