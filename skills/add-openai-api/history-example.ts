// Example implementation for src/api/history.ts

import { getDatabase } from '../db'; // Adjust path to your database module

export interface HistoryMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  channel?: string;
  timestamp?: number;
}

/**
 * Load cross-channel message history.
 *
 * Since Nanoclaw is single-user, all messages belong to the same user.
 * We load recent messages from ALL channels to provide full context.
 *
 * @param limit - Maximum number of messages to load (default: 100)
 * @returns Array of messages formatted for Claude conversation
 */
export async function loadCrossChannelHistory(limit: number = 100): Promise<HistoryMessage[]> {
  const db = getDatabase();

  // Load all recent messages across all channels
  // Messages are stored with chat_jid prefixes like:
  // - WhatsApp: 1234567890@s.whatsapp.net
  // - Telegram: tg:123456789
  // - LiveKit/Voice: lk:participant-id
  //
  // Note: Nanoclaw uses is_from_me (0=user, 1=assistant) not a role column
  const rows = db.query(`
    SELECT
      chat_jid,
      is_from_me,
      content,
      timestamp
    FROM messages
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(limit) as Array<{
    chat_jid: string;
    is_from_me: number;
    content: string;
    timestamp: string;
  }>;

  // Reverse to get chronological order
  const messages = rows.reverse();

  return messages.map(row => ({
    role: row.is_from_me ? 'assistant' : 'user',
    content: row.content,
    channel: extractChannelFromJid(row.chat_jid),
    timestamp: parseInt(row.timestamp, 10)
  }));
}

/**
 * Store a message from the API channel.
 *
 * @param chatJid - The JID for this session (e.g., "lk:participant-id")
 * @param isFromMe - Whether the message is from the assistant (true) or user (false)
 * @param content - Message content
 */
export async function storeApiMessage(
  chatJid: string,
  isFromMe: boolean,
  content: string
): Promise<void> {
  const db = getDatabase();
  const id = `api-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  db.run(`
    INSERT INTO messages (id, chat_jid, sender, content, timestamp, is_from_me)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [id, chatJid, isFromMe ? 'assistant' : 'user', content, Date.now().toString(), isFromMe ? 1 : 0]);
}

/**
 * Extract channel type from chat_jid.
 */
function extractChannelFromJid(chatJid: string): string {
  if (chatJid.includes('@s.whatsapp.net')) return 'whatsapp';
  if (chatJid.startsWith('tg:')) return 'telegram';
  if (chatJid.startsWith('lk:')) return 'livekit';
  return 'unknown';
}

/**
 * Format history messages with channel context for Claude.
 *
 * This helps Claude understand the multi-channel nature of the conversation.
 */
export function formatHistoryForClaude(messages: HistoryMessage[]): string {
  return messages.map(msg => {
    const channelTag = msg.channel ? `[${msg.channel}] ` : '';
    return `${channelTag}${msg.role}: ${msg.content}`;
  }).join('\n');
}
