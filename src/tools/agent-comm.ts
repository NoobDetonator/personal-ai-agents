import { tool } from 'ai';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { getDb } from '../db/connection.js';

export function createCommTools(agentId: string, dispatchFn: (from: string, to: string, content: string) => Promise<string>) {
  const sendMessageTool = tool({
    description: 'Enviar uma mensagem para outro agente de IA e receber a resposta dele',
    inputSchema: z.object({
      toAgent: z.string().describe('ID do agente destinatario (ex: "luna", "aria")'),
      message: z.string().describe('Conteudo da mensagem para o outro agente'),
    }),
    execute: async ({ toAgent, message }) => {
      try {
        const db = getDb();
        const id = randomUUID();

        db.prepare(
          'INSERT INTO agent_messages (id, from_agent, to_agent, content) VALUES (?, ?, ?, ?)'
        ).run(id, agentId, toAgent, message);

        const response = await dispatchFn(agentId, toAgent, message);

        db.prepare(
          'UPDATE agent_messages SET read = 1, response = ? WHERE id = ?'
        ).run(response, id);

        return {
          success: true,
          from: agentId,
          to: toAgent,
          message,
          response,
        };
      } catch (error) {
        return { error: `Erro ao enviar mensagem: ${error instanceof Error ? error.message : 'desconhecido'}` };
      }
    },
  });

  const checkMessagesTool = tool({
    description: 'Verificar se ha mensagens nao lidas de outros agentes',
    inputSchema: z.object({}),
    execute: async () => {
      const db = getDb();
      const unread = db.prepare(
        'SELECT id, from_agent, content, created_at FROM agent_messages WHERE to_agent = ? AND read = 0 ORDER BY created_at ASC'
      ).all(agentId) as Array<{ id: string; from_agent: string; content: string; created_at: string }>;

      if (unread.length === 0) {
        return { messages: [], message: 'Nenhuma mensagem nova.' };
      }

      // Mark as read
      const ids = unread.map(m => m.id);
      for (const id of ids) {
        db.prepare('UPDATE agent_messages SET read = 1 WHERE id = ?').run(id);
      }

      return {
        messages: unread.map(m => ({
          from: m.from_agent,
          content: m.content,
          receivedAt: m.created_at,
        })),
      };
    },
  });

  return { sendMessage: sendMessageTool, checkMessages: checkMessagesTool };
}
