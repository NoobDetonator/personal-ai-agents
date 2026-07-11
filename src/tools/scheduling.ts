import { tool } from 'ai';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { getDb } from '../db/connection.js';

export function createSchedulingTools(agentId: string) {
  const createScheduleTool = tool({
    description: 'Agendar uma tarefa recorrente. Use expressao cron (ex: "0 8 * * *" = todo dia as 8h, "*/30 * * * *" = a cada 30 min, "0 9 * * 1" = toda segunda as 9h)',
    inputSchema: z.object({
      cronExpression: z.string().describe('Expressao cron (ex: "0 8 * * *")'),
      taskDescription: z.string().describe('O que fazer quando a tarefa executar'),
    }),
    execute: async ({ cronExpression, taskDescription }) => {
      try {
        const db = getDb();
        const id = randomUUID();
        db.prepare(
          'INSERT INTO schedules (id, agent_id, cron_expr, task_prompt, enabled) VALUES (?, ?, ?, ?, 1)'
        ).run(id, agentId, cronExpression, taskDescription);

        // The scheduler engine will pick this up via config change or manual refresh
        return {
          success: true,
          id,
          message: `Tarefa agendada com sucesso! ID: ${id}`,
          cron: cronExpression,
          task: taskDescription,
        };
      } catch (error) {
        return { error: `Erro ao agendar tarefa: ${error instanceof Error ? error.message : 'desconhecido'}` };
      }
    },
  });

  const listSchedulesTool = tool({
    description: 'Listar todas as tarefas agendadas',
    inputSchema: z.object({}),
    execute: async () => {
      const db = getDb();
      const schedules = db.prepare(
        'SELECT id, agent_id, cron_expr, task_prompt, enabled, last_run, created_at FROM schedules ORDER BY created_at DESC'
      ).all();
      return { schedules };
    },
  });

  const deleteScheduleTool = tool({
    description: 'Remover uma tarefa agendada pelo ID',
    inputSchema: z.object({
      scheduleId: z.string().describe('ID da tarefa a remover'),
    }),
    execute: async ({ scheduleId }) => {
      const db = getDb();
      const result = db.prepare('DELETE FROM schedules WHERE id = ?').run(scheduleId);
      if (result.changes === 0) {
        return { error: `Tarefa "${scheduleId}" nao encontrada.` };
      }
      return { success: true, message: `Tarefa ${scheduleId} removida.` };
    },
  });

  return { createSchedule: createScheduleTool, listSchedules: listSchedulesTool, deleteSchedule: deleteScheduleTool };
}
