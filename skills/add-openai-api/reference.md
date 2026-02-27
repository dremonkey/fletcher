# API Reference

Extended event format, cross-channel context, security, and limitations.

## Extended Event Format

### Status Events

Emitted during long-running operations to provide feedback:

```json
{"type": "status", "action": "searching_files", "detail": "src/**/*.ts"}
{"type": "status", "action": "reading_file", "file": "src/utils.ts"}
{"type": "status", "action": "web_search", "query": "typescript best practices"}
{"type": "status", "action": "thinking"}
```

Fletcher routes these to:
- Visualizer state (shows "working" indicator)
- Optional TTS ("Let me search for that...")

### Artifact Events

Emitted for visual content that shouldn't be spoken:

```json
{"type": "artifact", "artifact_type": "diff", "file": "src/utils.ts", "diff": "@@ -10,3 +10,5 @@..."}
{"type": "artifact", "artifact_type": "code", "language": "typescript", "content": "function foo() {...}"}
{"type": "artifact", "artifact_type": "file", "path": "src/utils.ts", "content": "..."}
{"type": "artifact", "artifact_type": "search_results", "query": "...", "results": [...]}
```

Fletcher routes these to:
- LiveKit data channel -> Flutter app
- Rendered as diff viewer, code blocks, etc.

### Content Events

Standard OpenAI format, spoken via TTS:

```json
{"id": "chatcmpl-xxx", "choices": [{"delta": {"content": "Hello!"}}]}
```

## Cross-Channel Context

The API automatically loads history from all channels. Example flow:

```
[WhatsApp 9:00am] User: "Remind me to call mom tomorrow at 5pm"
[WhatsApp 9:01am] Bot:  "I'll remind you to call mom tomorrow at 5pm"

[Voice 2:00pm via Fletcher]
User: "What reminders do I have?"
# API loads WhatsApp history, provides context to Claude
Bot: "You have one reminder: call mom tomorrow at 5pm"
```

## Security Notes

- The API listens on localhost by default
- No authentication (single-user system)
- For remote access, use a reverse proxy with authentication
- Do not expose directly to the internet

## Limitations

### User-Initiated Only

This API integration supports **inbound requests only** - the user must initiate voice conversations. Nanoclaw cannot proactively "call" the user.

**What works:**
- User opens app -> connects to LiveKit -> speaks -> Nanoclaw responds
- User asks "Any reminders?" -> Nanoclaw reads pending reminders
- User says "What's on my calendar?" -> Nanoclaw provides schedule

**What doesn't work:**
- Wake-up alarm that calls the user at 8am
- Proactive reminder that interrupts the user
- Nanoclaw initiating a voice conversation

### Workarounds for Proactive Voice

| Approach | How It Works | Requirements |
|----------|--------------|--------------|
| **Push + User Action** | Send push notification, user taps to connect, then Nanoclaw speaks | FCM/APNs integration |
| **Background Connection** | App stays connected to LiveKit, Nanoclaw sends when ready | Background audio permissions, battery impact |
| **Phone Call** | Use Twilio to place actual phone call | Twilio account, phone number, per-call costs |
| **Scheduled Check-in** | User configures app to auto-connect at certain times | App scheduling, user opt-in |

### No Outbound Webhook

The API does not provide a callback/webhook mechanism for Nanoclaw to notify Fletcher when it has something to say. Communication is strictly request-response.

### No Dedicated Channel UI

Voice conversations are stored in the `messages` table with `lk:` JID prefix, but there's no dedicated UI for viewing transcripts.

**What's stored:**
```sql
SELECT * FROM messages WHERE chat_jid LIKE 'lk:%';

-- Example rows:
-- | chat_jid  | is_from_me | content              | timestamp   |
-- |-----------|------------|----------------------|-------------|
-- | lk:alice  | 0          | What time is it?     | 1234567890  |
-- | lk:alice  | 1          | It's 3:45 PM.        | 1234567891  |
```

**What a transcript UI would need:**

| Component | Data Available? | Notes |
|-----------|-----------------|-------|
| Message text | Yes | Stored in `content` column |
| Speaker (user/assistant) | Yes | `is_from_me` column (0=user, 1=assistant) |
| Timestamp | Yes | `timestamp` column |
| Participant identity | Yes | Extracted from `chat_jid` (e.g., `lk:alice` -> `alice`) |
| Channel type label | Derive | UI would map `lk:` prefix -> "Voice" label |
| Audio playback | No | Audio not stored, only transcriptions |
| Tool calls / artifacts | No | Status/artifact events not persisted to DB |
| Voice activity visualization | No | No audio waveforms or timing data |
