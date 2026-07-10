import { tool } from 'ai';
import { z } from 'zod';
import { getDb } from '../db/connection.js';
import { deleteConversation, deleteAllConversations } from '../db/conversation-helpers.js';
import { emitBus } from '../web/bus.js';

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
    'Buscar em TODAS as conversas passadas (de todas as sessoes) por palavras-chave. Use quando o usuario mencionar algo que pode ter sido discutido antes e que nao esta na sua memoria nem no historico atual.',
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
         WHERE messages_fts MATCH ?
         ORDER BY rank
         LIMIT ?`
      ).all(toFtsQuery(query), limit ?? 10) as SearchRow[];

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
      const count = deleteAllConversations(target);
      emitBus('conversation_changed', { agentId: target, action: 'cleared', count });
      return { success: true, deleted: count };
    },
  });

  return { deleteConversation: deleteConversationTool, clearConversations: clearConversationsTool };
}
