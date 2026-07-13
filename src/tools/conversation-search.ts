import { tool } from 'ai';
import { z } from 'zod';
import { getDb } from '../db/connection.js';
import { deleteConversation } from '../db/conversation-helpers.js';
import { emitBus } from '../web/bus.js';
import { getProjectContext } from '../projects/context.js';
import { askConfirmation } from '../chat/confirm.js';

interface SearchRow {
  conversation_id: string;
  title: string | null;
  role: string;
  agent_id: string | null;
  created_at: string;
  snip: string;
}

/** Sanitizes user input into a safe FTS5 MATCH query (quoted AND terms). */
function toFtsQuery(query: string): string {
  const terms = query
    .split(/\s+/)
    .map(t => t.replace(/"/g, '').trim())
    .filter(t => t.length > 0);
  if (terms.length === 0) return '""';
  return terms.map(t => `"${t}"`).join(' ');
}

export const searchConversationsTool = tool({
  description:
    'Buscar nas conversas passadas do projeto atual por palavras-chave. Use quando o usuario mencionar algo discutido antes que nao esta na memoria nem no historico atual.',
  inputSchema: z.object({
    query: z.string().describe('Palavras-chave a buscar (ex: "projeto delivery orcamento")'),
    limit: z.number().int().min(1).max(30).optional().describe('Maximo de resultados (padrao 10)'),
  }),
  execute: async ({ query, limit }) => {
    try {
      const db = getDb();
      const rows = db.prepare(
        `SELECT m.conversation_id, c.title, m.role, m.agent_id, m.created_at,
                snippet(messages_fts, 0, '>>', '<<', ' ... ', 16) AS snip
         FROM messages_fts
         JOIN messages m ON m.rowid = messages_fts.rowid
         JOIN conversations c ON c.id = m.conversation_id
         WHERE messages_fts MATCH ? AND COALESCE(c.project_id, 'legacy') = ?
         ORDER BY rank
         LIMIT ?`
      ).all(toFtsQuery(query), getProjectContext()?.projectId ?? 'legacy', limit ?? 10) as SearchRow[];

      if (rows.length === 0) {
        return { results: [], message: 'Nada encontrado nas conversas passadas para essa busca.' };
      }

      return {
        results: rows.map(r => ({
          conversation: r.title ?? r.conversation_id,
          date: r.created_at,
          who: r.role === 'user' ? 'usuario' : (r.agent_id ?? 'assistente'),
          trecho: r.snip,
        })),
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'erro desconhecido';
      return { error: `Falha na busca: ${msg}` };
    }
  },
});

export function createConversationMgmtTools(agentId: string) {
  const deleteConversationTool = tool({
    description: 'Deletar uma conversa (e todas as mensagens dela) permanentemente pelo ID',
    inputSchema: z.object({
      conversationId: z.string().describe('ID da conversa a deletar'),
    }),
    execute: async ({ conversationId }) => {
      const projectId = getProjectContext()?.projectId ?? 'legacy';
      const owned = getDb().prepare(
        "SELECT 1 FROM conversations WHERE id = ? AND COALESCE(project_id, 'legacy') = ?",
      ).get(conversationId, projectId);
      if (!owned) return { error: `Conversa "${conversationId}" nao encontrada.` };
      const confirmation = await askConfirmation(
        `Apagar permanentemente a conversa "${conversationId}" e todas as mensagens dela?`,
        { allowAlways: false },
      );
      if (confirmation.answer !== 'yes') {
        return { error: confirmation.timedOut
          ? 'Confirmacao expirou. A conversa nao foi apagada.'
          : 'Exclusao negada pelo usuario. A conversa nao foi apagada.' };
      }
      const ok = deleteConversation(conversationId);
      if (!ok) return { error: `Conversa "${conversationId}" nao encontrada.` };
      emitBus('conversation_changed', { conversationId, action: 'deleted' });
      return { success: true, conversationId };
    },
  });

  const clearConversationsTool = tool({
    description: 'Apagar TODO o historico de conversas de um agente (padrao: voce mesmo). Use so quando o usuario pedir explicitamente para limpar o historico.',
    inputSchema: z.object({
      targetAgentId: z.string().optional().describe('ID do agente cujas conversas serao apagadas (padrao: voce mesmo)'),
    }),
    execute: async ({ targetAgentId }) => {
      const target = targetAgentId ?? agentId;
      const projectId = getProjectContext()?.projectId ?? 'legacy';
      const count = (getDb().prepare(
        "SELECT COUNT(*) AS count FROM conversations WHERE agent_id = ? AND COALESCE(project_id, 'legacy') = ?",
      ).get(target, projectId) as { count: number }).count;
      if (count === 0) return { success: true, deleted: 0 };
      const confirmation = await askConfirmation(
        `Apagar permanentemente ${count} conversa(s) do agente "${target}"?`,
        { allowAlways: false },
      );
      if (confirmation.answer !== 'yes') {
        return { error: confirmation.timedOut
          ? 'Confirmacao expirou. Nenhuma conversa foi apagada.'
          : 'Limpeza negada pelo usuario. Nenhuma conversa foi apagada.' };
      }
      const deleted = getDb().prepare(
        "DELETE FROM conversations WHERE agent_id = ? AND COALESCE(project_id, 'legacy') = ?",
      ).run(target, projectId).changes;
      emitBus('conversation_changed', { agentId: target, action: 'cleared', count: deleted });
      return { success: true, deleted };
    },
  });

  return { deleteConversation: deleteConversationTool, clearConversations: clearConversationsTool };
}
