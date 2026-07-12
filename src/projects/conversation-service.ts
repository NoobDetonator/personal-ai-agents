import { randomUUID } from 'node:crypto';
import { getDb } from '../db/connection.js';
import { LEGACY_PROJECT_ID } from '../db/schema.js';

// Conversas escopadas por projeto (ADR 0003). Complementa
// db/conversation-helpers.ts (usado pela CLI legada) sem substituí-lo.

export interface ProjectConversation {
  id: string;
  project_id: string;
  agent_id: string;
  type: string;
  title: string | null;
  archived: number;
  pinned: number;
  last_run_status: string | null;
  updated_at: string;
  message_count: number;
}

export function createProjectConversation(
  projectId: string,
  agentId: string,
  opts?: { title?: string; createdBy?: string },
): string {
  const db = getDb();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO conversations (id, agent_id, type, title, project_id, created_by)
     VALUES (?, ?, 'direct', ?, ?, ?)`,
  ).run(id, agentId, opts?.title ?? `Conversa com ${agentId}`, projectId, opts?.createdBy ?? null);
  return id;
}

export function listProjectConversations(
  projectId: string,
  opts?: { includeArchived?: boolean },
): ProjectConversation[] {
  const db = getDb();
  const archivedClause = opts?.includeArchived ? '' : 'AND c.archived = 0';
  return db.prepare(
    `SELECT c.id, c.project_id, c.agent_id, c.type, c.title, c.archived, c.pinned,
            c.last_run_status, c.updated_at,
            (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
     FROM conversations c
     WHERE c.project_id = ? ${archivedClause}
     ORDER BY c.pinned DESC, c.updated_at DESC`,
  ).all(projectId) as ProjectConversation[];
}

/** Projeto e agente de uma conversa. project_id ausente cai no Legacy. */
export function getConversationContext(conversationId: string): { projectId: string; agentId: string } | null {
  const row = getDb().prepare(
    'SELECT project_id, agent_id FROM conversations WHERE id = ?',
  ).get(conversationId) as { project_id: string | null; agent_id: string } | undefined;
  if (!row) return null;
  return { projectId: row.project_id ?? LEGACY_PROJECT_ID, agentId: row.agent_id };
}

export function patchConversation(
  conversationId: string,
  patch: { title?: string; pinned?: boolean; archived?: boolean },
): boolean {
  const db = getDb();
  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.title !== undefined) { sets.push('title = ?'); values.push(patch.title); }
  if (patch.pinned !== undefined) { sets.push('pinned = ?'); values.push(patch.pinned ? 1 : 0); }
  if (patch.archived !== undefined) { sets.push('archived = ?'); values.push(patch.archived ? 1 : 0); }
  if (sets.length === 0) return false;
  values.push(conversationId);
  const info = db.prepare(`UPDATE conversations SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return info.changes > 0;
}

/**
 * Persiste uma mensagem vinculada a um run, com sequence monotônico por
 * conversa. status: 'complete' | 'error' | etc. (metadata livre em metadata_json).
 */
export function saveRunMessage(input: {
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  agentId: string | null;
  runId: string;
  inputTokens?: number;
  outputTokens?: number;
  status?: string;
  metadata?: unknown;
}): void {
  const db = getDb();
  const save = db.transaction(() => {
    const seqRow = db.prepare(
      'SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM messages WHERE conversation_id = ?',
    ).get(input.conversationId) as { next: number };
    db.prepare(
      `INSERT INTO messages (id, conversation_id, role, content, agent_id, run_id, sequence, status, metadata_json, input_tokens, output_tokens)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      input.conversationId,
      input.role,
      input.content,
      input.agentId,
      input.runId,
      seqRow.next,
      input.status ?? null,
      input.metadata === undefined ? null : JSON.stringify(input.metadata),
      input.inputTokens ?? 0,
      input.outputTokens ?? 0,
    );
    db.prepare(`UPDATE conversations SET updated_at = datetime('now') WHERE id = ?`).run(input.conversationId);
  });
  save();
}
