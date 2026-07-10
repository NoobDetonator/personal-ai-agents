import { getDb } from './connection.js';
import { randomUUID } from 'node:crypto';
import type { ModelMessage } from 'ai';

interface DbMessage {
  role: string;
  content: string;
}

export function getOrCreateConversation(agentId: string): string {
  const db = getDb();

  const existing = db.prepare(
    `SELECT id FROM conversations
     WHERE agent_id = ? AND type = 'direct'
     ORDER BY updated_at DESC LIMIT 1`
  ).get(agentId) as { id: string } | undefined;

  if (existing) return existing.id;

  return createNewConversation(agentId);
}

export function createNewConversation(agentId: string): string {
  const db = getDb();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO conversations (id, agent_id, type, title) VALUES (?, ?, 'direct', ?)`
  ).run(id, agentId, `Conversa com ${agentId}`);
  return id;
}

export function saveDirectMessage(
  conversationId: string,
  role: 'user' | 'assistant',
  content: string,
  agentId: string | null,
  inputTokens: number = 0,
  outputTokens: number = 0,
): void {
  try {
    const db = getDb();
    db.prepare(
      `INSERT INTO messages (id, conversation_id, role, content, agent_id, input_tokens, output_tokens)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(randomUUID(), conversationId, role, content, agentId, inputTokens, outputTokens);

    db.prepare(
      `UPDATE conversations SET updated_at = datetime('now') WHERE id = ?`
    ).run(conversationId);
  } catch {
    // Best-effort persistence
  }
}

export interface ConversationSummary {
  id: string;
  agent_id: string;
  type: string;
  title: string | null;
  updated_at: string;
  message_count: number;
}

export function listConversations(agentId: string, limit: number = 15): ConversationSummary[] {
  try {
    const db = getDb();
    return db.prepare(
      `SELECT c.id, c.agent_id, c.type, c.title, c.updated_at,
              (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
       FROM conversations c
       WHERE c.agent_id = ?
       ORDER BY c.updated_at DESC LIMIT ?`
    ).all(agentId, limit) as ConversationSummary[];
  } catch {
    return [];
  }
}

/**
 * Resolve uma conversa por prefixo de id (min. 4 chars). Retorna null se
 * nao encontrada ou prefixo ambiguo.
 */
export function findConversationByPrefix(idPrefix: string): ConversationSummary | null {
  const prefix = idPrefix.trim().toLowerCase();
  if (prefix.length < 4) return null;
  try {
    const db = getDb();
    const rows = db.prepare(
      `SELECT c.id, c.agent_id, c.type, c.title, c.updated_at,
              (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
       FROM conversations c WHERE c.id LIKE ? LIMIT 2`
    ).all(prefix + '%') as ConversationSummary[];
    return rows.length === 1 ? rows[0] : null;
  } catch {
    return null;
  }
}

export function loadConversationById(conversationId: string, maxMessages: number): ModelMessage[] {
  try {
    const db = getDb();
    const rows = db.prepare(
      `SELECT role, content FROM messages
       WHERE conversation_id = ? ORDER BY created_at ASC`
    ).all(conversationId) as DbMessage[];

    const messages: ModelMessage[] = rows
      .slice(-maxMessages)
      .filter(r => r.role === 'user' || r.role === 'assistant')
      .map(r => ({ role: r.role as 'user' | 'assistant', content: r.content }));

    while (messages.length > 0 && messages[0].role !== 'user') {
      messages.shift();
    }
    return messages;
  } catch {
    return [];
  }
}

/** Clona uma conversa (mensagens incluidas) e retorna o id do clone. */
export function forkConversation(conversationId: string): string | null {
  try {
    const db = getDb();
    const original = db.prepare('SELECT agent_id, type, title FROM conversations WHERE id = ?')
      .get(conversationId) as { agent_id: string; type: string; title: string | null } | undefined;
    if (!original) return null;

    const newId = randomUUID();
    db.prepare(
      `INSERT INTO conversations (id, agent_id, type, title) VALUES (?, ?, ?, ?)`
    ).run(newId, original.agent_id, original.type, `Fork de ${original.title ?? conversationId.slice(0, 8)}`);

    const messages = db.prepare(
      `SELECT role, content, agent_id, tool_calls, input_tokens, output_tokens, created_at
       FROM messages WHERE conversation_id = ? ORDER BY created_at ASC`
    ).all(conversationId) as Array<Record<string, unknown>>;

    const insert = db.prepare(
      `INSERT INTO messages (id, conversation_id, role, content, agent_id, tool_calls, input_tokens, output_tokens, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const m of messages) {
      insert.run(randomUUID(), newId, m.role, m.content, m.agent_id, m.tool_calls, m.input_tokens, m.output_tokens, m.created_at);
    }

    return newId;
  } catch {
    return null;
  }
}

/** Deleta uma conversa e suas mensagens (cascade via FK). Retorna false se nao encontrada. */
export function deleteConversation(conversationId: string): boolean {
  const db = getDb();
  const info = db.prepare('DELETE FROM conversations WHERE id = ?').run(conversationId);
  return info.changes > 0;
}

/** Deleta TODAS as conversas de um agente (e mensagens, via cascade). Retorna quantas foram removidas. */
export function deleteAllConversations(agentId: string): number {
  const db = getDb();
  const info = db.prepare('DELETE FROM conversations WHERE agent_id = ?').run(agentId);
  return info.changes;
}

export function loadLastConversation(agentId: string, maxMessages: number): {
  conversationId: string | null;
  messages: ModelMessage[];
} {
  try {
    const db = getDb();

    const conversation = db.prepare(
      `SELECT id FROM conversations
       WHERE agent_id = ? AND type = 'direct'
       ORDER BY updated_at DESC LIMIT 1`
    ).get(agentId) as { id: string } | undefined;

    if (!conversation) return { conversationId: null, messages: [] };

    const rows = db.prepare(
      `SELECT role, content FROM messages
       WHERE conversation_id = ?
       ORDER BY created_at ASC`
    ).all(conversation.id) as DbMessage[];

    const recent = rows.slice(-maxMessages);

    const messages: ModelMessage[] = recent
      .filter(r => r.role === 'user' || r.role === 'assistant')
      .map(r => ({
        role: r.role as 'user' | 'assistant',
        content: r.content,
      }));

    // Ensure array starts with 'user' role
    while (messages.length > 0 && messages[0].role !== 'user') {
      messages.shift();
    }

    return { conversationId: conversation.id, messages };
  } catch {
    return { conversationId: null, messages: [] };
  }
}
